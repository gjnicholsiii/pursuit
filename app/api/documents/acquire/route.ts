import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface PendingDocumentRow {
  id: string;
  opportunity_id: string;
  source_url: string;
  filename: string;
  source_family: string;
}

function filenameFromDisposition(value: string | null) {
  if (!value) return null;
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try { return decodeURIComponent(utf8[1]); } catch { return utf8[1]; }
  }
  const plain = value.match(/filename="?([^";]+)"?/i);
  return plain?.[1] || null;
}

function safeFilename(value: string) {
  return value.replace(/\+/g, " ").replace(/[^a-zA-Z0-9._() -]+/g, "-").replace(/\s+/g, " ").trim() || "document";
}

function looksValid(bytes: ArrayBuffer, contentType: string, filename: string) {
  const view = new Uint8Array(bytes.slice(0, 8));
  const head = String.fromCharCode(...view);
  const lowerType = contentType.toLowerCase();
  const lowerName = filename.toLowerCase();
  if (lowerType.includes("text/html") || /^\s*</.test(head)) return false;
  if (lowerName.endsWith(".pdf") || lowerType.includes("application/pdf")) return head.startsWith("%PDF");
  if (/\.(docx|xlsx|pptx|zip)$/i.test(lowerName)) return head.startsWith("PK");
  return bytes.byteLength > 0;
}

async function acquireOne(document: PendingDocumentRow) {
  const sql = getSql();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(document.source_url, {
      redirect: "follow", signal: controller.signal,
      headers: { "User-Agent": "Pursuit/1.0 procurement document indexer", Accept: "*/*" }, cache: "no-store",
    });
    if (!response.ok) {
      await sql.query(`update opportunity_documents set extraction_status='fetch_failed' where id=$1`, [document.id]);
      return { ok:false, documentId:document.id, status:response.status, reason:"http" };
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 25 * 1024 * 1024) {
      await sql.query(`update opportunity_documents set extraction_status='fetch_too_large' where id=$1`, [document.id]);
      return { ok:false, documentId:document.id, status:413, reason:"too_large" };
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 25 * 1024 * 1024) {
      await sql.query(`update opportunity_documents set extraction_status='fetch_too_large' where id=$1`, [document.id]);
      return { ok:false, documentId:document.id, status:413, reason:"too_large" };
    }
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const filename = safeFilename(filenameFromDisposition(response.headers.get("content-disposition")) || document.filename);
    if (!looksValid(bytes, contentType, filename)) {
      await sql.query(`update opportunity_documents set extraction_status='fetch_invalid' where id=$1`, [document.id]);
      return { ok:false, documentId:document.id, status:422, reason:"invalid_payload", contentType };
    }
    const family = document.source_family === "sled" ? "sled" : "sam";
    const pathname = `${family}/${document.opportunity_id}/${document.id}/${filename}`;
    const blob = await put(pathname, bytes, { access:"private", contentType, addRandomSuffix:false, allowOverwrite:true });
    await sql.query(
      `update opportunity_documents set filename=$2, storage_key=$3, fetched_at=now(), extraction_status='fetched' where id=$1`,
      [document.id, filename, blob.pathname],
    );
    return { ok:true, documentId:document.id, opportunityId:document.opportunity_id, filename, bytes:bytes.byteLength, contentType, storageKey:blob.pathname };
  } catch (error) {
    await sql.query(`update opportunity_documents set extraction_status='fetch_failed' where id=$1`, [document.id]);
    return { ok:false, documentId:document.id, status:502, reason:error instanceof Error ? error.message : "fetch_failed" };
  } finally { clearTimeout(timeout); }
}

export async function GET() {
  if (!process.env.BLOB_STORE_ID) return NextResponse.json({ ok:false, error:"BLOB_STORE_ID is not available to this deployment" }, { status:503 });
  const sql = getSql();
  const rows = await sql.query(
    `with eligible as (
       select d.id,d.opportunity_id,d.source_url,d.filename,s.source_family,s.adapter_key,a.agency_type,o.due_at
       from opportunity_documents d
       join opportunities o on o.id=d.opportunity_id
       join sources s on s.id=o.source_id
       join agencies a on a.id=o.agency_id
       where d.extraction_status='pending' and d.is_missing=false and d.storage_key is null
         and o.status='open' and (o.due_at is null or o.due_at >= now())
     ),
     education as (
       select *,1 as bucket from eligible where agency_type in ('k12','higher_ed')
       order by due_at asc nulls last,id limit 30
     ),
     federal as (
       select *,2 as bucket from eligible where adapter_key='sam_gov'
       order by due_at asc nulls last,id limit 25
     ),
     sled_other as (
       select *,3 as bucket from eligible
       where source_family='sled' and agency_type not in ('k12','higher_ed')
       order by due_at asc nulls last,id limit 25
     )
     select distinct on (id) id,opportunity_id,source_url,filename,source_family
     from (select * from education union all select * from federal union all select * from sled_other) x
     order by id,bucket`,
  ) as PendingDocumentRow[];

  if (!rows.length) return NextResponse.json({ ok:true, processed:0, message:"No pending documents remain" });
  const results=[] as Array<Record<string,unknown>>;
  const concurrency=8;
  for(let i=0;i<rows.length;i+=concurrency) results.push(...await Promise.all(rows.slice(i,i+concurrency).map(acquireOne)));
  const fetched=results.filter(result=>result.ok).length;
  return NextResponse.json({ ok:true, processed:results.length, fetched, failed:results.length-fetched, results });
}
