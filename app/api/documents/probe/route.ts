import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface ProbeRow {
  id: string;
  opportunity_id: string;
  source_url: string;
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

export async function GET() {
  const sql = getSql();
  const rows = await sql.query(
    `select d.id, d.opportunity_id, d.source_url
     from opportunity_documents d
     join opportunities o on o.id = d.opportunity_id
     join sources s on s.id = o.source_id
     where s.adapter_key = 'sam_gov'
       and d.extraction_status = 'pending'
       and d.is_missing = false
     order by o.due_at asc nulls last, d.id
     limit 1`,
  ) as ProbeRow[];

  const document = rows[0];
  if (!document) return NextResponse.json({ ok: false, message: "No pending SAM documents found" }, { status: 404 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(document.source_url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Pursuit/0.1", Accept: "*/*" },
      cache: "no-store",
    });

    const contentLength = Number(response.headers.get("content-length") || 0) || null;
    const contentType = response.headers.get("content-type");
    const filename = filenameFromDisposition(response.headers.get("content-disposition"));
    const reader = response.body?.getReader();
    let bytesRead = 0;
    const limit = 65536;

    if (reader) {
      while (bytesRead < limit) {
        const { value, done } = await reader.read();
        if (done) break;
        bytesRead += value?.byteLength || 0;
        if (bytesRead >= limit) {
          await reader.cancel();
          break;
        }
      }
    }

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      documentId: document.id,
      opportunityId: document.opportunity_id,
      sourceUrl: document.source_url,
      contentType,
      contentLength,
      filename,
      sampleBytesRead: bytesRead,
      finalUrl: response.url,
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      documentId: document.id,
      opportunityId: document.opportunity_id,
      sourceUrl: document.source_url,
      error: error instanceof Error ? error.message : "Document fetch failed",
    }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
