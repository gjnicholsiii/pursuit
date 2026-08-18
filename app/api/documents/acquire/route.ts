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
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ ok: false, error: "BLOB_READ_WRITE_TOKEN is not available to this deployment" }, { status: 503 });
  }

  const sql = getSql();
  const rows = await sql.query(
    `select d.id, d.opportunity_id, d.source_url, d.filename
     from opportunity_documents d
     join opportunities o on o.id = d.opportunity_id
     join sources s on s.id = o.source_id
     where s.adapter_key = 'sam_gov'
       and d.extraction_status = 'pending'
       and d.is_missing = false
       and d.storage_key is null
     order by o.due_at asc nulls last, d.id
     limit 1`,
  ) as PendingDocumentRow[];

  const document = rows[0];
  if (!document) return NextResponse.json({ ok: true, message: "No pending SAM documents remain" });

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
         set is_missing = true, extraction_status = 'fetch_failed'
         where id = $1`,
        [document.id],
      );
      return NextResponse.json({ ok: false, status: response.status, documentId: document.id }, { status: 502 });
    }

    const bytes = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const filename = safeFilename(filenameFromDisposition(response.headers.get("content-disposition")) || document.filename);
    const pathname = `sam/${document.opportunity_id}/${document.id}/${filename}`;

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
      filename,
      bytes: bytes.byteLength,
      contentType,
      storageKey: blob.pathname,
      extractionStatus: "fetched",
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      documentId: document.id,
      error: error instanceof Error ? error.message : "Document acquisition failed",
    }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
