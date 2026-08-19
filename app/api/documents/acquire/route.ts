import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

export async function GET() {
  if (!process.env.BLOB_STORE_ID) {
    return NextResponse.json({ ok: false, error: "BLOB_STORE_ID is not available to this deployment" }, { status: 503 });
  }

  const sql = getSql();
  const rows = await sql.query(
    `select d.id, d.opportunity_id, d.source_url, d.filename, s.source_family
     from opportunity_documents d
     join opportunities o on o.id = d.opportunity_id
     join sources s on s.id = o.source_id
     where d.extraction_status = 'pending'
       and d.is_missing = false
       and d.storage_key is null
     order by case when d.document_type='ionwave_attachment' then 0 when s.source_family='sled' then 1 else 2 end,
              o.due_at asc nulls last, d.id
     limit 1`,
  ) as PendingDocumentRow[];

  const document = rows[0];
  if (!document) return NextResponse.json({ ok: true, message: "No pending documents remain" });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(document.source_url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Pursuit/0.1", Accept: "*/*" },
      cache: "no-store",
    });

    if (!response.ok) {
      await sql.query(
        `update opportunity_documents
         set extraction_status = 'fetch_failed'
         where id = $1`,
        [document.id],
      );
      return NextResponse.json({ ok: false, status: response.status, documentId: document.id }, { status: 502 });
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 25 * 1024 * 1024) {
      await sql.query(`update opportunity_documents set extraction_status='fetch_too_large' where id=$1`, [document.id]);
      return NextResponse.json({ ok:false, documentId:document.id, error:"Document exceeds 25 MB acquisition limit" }, { status:413 });
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 25 * 1024 * 1024) {
      await sql.query(`update opportunity_documents set extraction_status='fetch_too_large' where id=$1`, [document.id]);
      return NextResponse.json({ ok:false, documentId:document.id, error:"Document exceeds 25 MB acquisition limit" }, { status:413 });
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const filename = safeFilename(filenameFromDisposition(response.headers.get("content-disposition")) || document.filename);
    const family = document.source_family === "sled" ? "sled" : "sam";
    const pathname = `${family}/${document.opportunity_id}/${document.id}/${filename}`;

    const blob = await put(pathname, bytes, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    await sql.query(
      `update opportunity_documents
       set filename = $2,
           storage_key = $3,
           fetched_at = now(),
           extraction_status = 'fetched'
       where id = $1`,
      [document.id, filename, blob.pathname],
    );

    return NextResponse.json({
      ok: true,
      documentId: document.id,
      opportunityId: document.opportunity_id,
      sourceFamily: document.source_family,
      filename,
      bytes: bytes.byteLength,
      contentType,
      storageKey: blob.pathname,
      extractionStatus: "fetched",
    });
  } catch (error) {
    await sql.query(`update opportunity_documents set extraction_status='fetch_failed' where id=$1`, [document.id]);
    return NextResponse.json({
      ok: false,
      documentId: document.id,
      error: error instanceof Error ? error.message : "Document acquisition failed",
    }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
