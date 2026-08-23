import { put } from "@vercel/blob";
import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_STREAM_BYTES = 1024 * 1024 * 1024;

type LargeDocumentRow = {
  job_id: string;
  id: string;
  opportunity_id: string;
  source_url: string;
  opportunity_source_url: string;
  filename: string;
  source_family: string;
  host_class: string;
  priority: number;
  meta: Record<string, unknown> | null;
};

function safeFilename(value: string) {
  return value.replace(/\+/g, " ").replace(/[^a-zA-Z0-9._() -]+/g, "-").replace(/\s+/g, " ").trim() || "document";
}

function normalizedName(value: string) {
  return safeFilename(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function filenameFromDisposition(value: string | null) {
  if (!value) return null;
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try { return decodeURIComponent(utf8[1]); } catch { return utf8[1]; }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] || null;
}

function cookieHeader(headers: Headers) {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.() || (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
  return values.map(value => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

function periscopeDetailUrl(row: LargeDocumentRow) {
  for (const candidate of [row.opportunity_source_url, row.source_url]) {
    try {
      const url = new URL(candidate);
      if (!/\/bso\/external\/bidDetail\.sda$/i.test(url.pathname)) continue;
      url.searchParams.delete("downloadFileNbr");
      url.searchParams.delete("mode");
      url.searchParams.delete("fn");
      return url.toString();
    } catch {}
  }
  return row.opportunity_source_url;
}

async function fetchPeriscope(row: LargeDocumentRow, signal: AbortSignal, baseHeaders: Record<string, string>) {
  const detailUrl = periscopeDetailUrl(row);
  const page = await fetch(detailUrl, {
    redirect: "follow",
    signal,
    cache: "no-store",
    headers: { ...baseHeaders, Accept: "text/html,application/xhtml+xml,*/*" },
  });
  if (!page.ok) return page;
  const cookie = cookieHeader(page.headers);
  const html = await page.text();
  const $ = cheerio.load(html);
  const wanted = normalizedName(row.filename);
  let fileNbr = "";
  $("a,button,[onclick]").each((_, node) => {
    if (fileNbr) return;
    const el = $(node);
    const text = normalizedName(el.text());
    const raw = [el.attr("onclick") || "", el.attr("href") || ""].join(" ");
    const match = raw.match(/downloadFile\s*\(\s*['\"]?(\d+)['\"]?\s*\)/i) || raw.match(/[?&]downloadFileNbr=(\d+)/i);
    if (match && (text === wanted || text.includes(wanted) || wanted.includes(text) || normalizedName(raw).includes(wanted))) fileNbr = match[1];
  });
  if (!fileNbr) {
    try { fileNbr = new URL(row.source_url).searchParams.get("downloadFileNbr") || ""; } catch {}
  }
  if (!fileNbr) return new Response("Periscope attachment number unresolved", { status: 404 });
  const download = new URL(page.url);
  download.searchParams.set("downloadFileNbr", fileNbr);
  download.searchParams.set("mode", "download");
  download.searchParams.set("fn", row.filename);
  await getSql().query(`update opportunity_documents set source_url=$2 where id=$1::uuid`, [row.id, download.toString()]);
  const headers: Record<string, string> = { ...baseHeaders, Referer: page.url, Accept: "application/pdf,application/octet-stream,*/*" };
  if (cookie) headers.Cookie = cookie;
  return fetch(download, { redirect: "follow", signal, cache: "no-store", headers });
}

async function fetchDocument(row: LargeDocumentRow, signal: AbortSignal) {
  const baseHeaders = { "User-Agent": "Mozilla/5.0 (compatible; Pursuit/1.0; +https://pursuit-neon.vercel.app)", Accept: "*/*" };
  if (row.host_class === "sam") {
    const apiKey = process.env.SAM_GOV_API_KEY;
    if (apiKey && /sam\.gov\/api\/prod\/opps\/v3\/opportunities\/resources\/files\//i.test(row.source_url)) {
      const url = new URL(row.source_url);
      if (!url.searchParams.has("api_key")) url.searchParams.set("api_key", apiKey);
      return fetch(url, { redirect: "follow", signal, cache: "no-store", headers: baseHeaders });
    }
  }
  if (/\/bso\/external\/bidDetail\.sda/i.test(`${row.opportunity_source_url} ${row.source_url}`)) {
    return fetchPeriscope(row, signal, baseHeaders);
  }
  return fetch(row.source_url, { redirect: "follow", signal, cache: "no-store", headers: { ...baseHeaders, Referer: row.opportunity_source_url } });
}

async function streamForBlob(response: Response, filename: string) {
  if (!response.body) throw new Error("empty_body");
  const reader = response.body.getReader();
  const first = await reader.read();
  if (first.done || !first.value?.byteLength) throw new Error("empty_body");
  const head = String.fromCharCode(...first.value.slice(0, 8));
  const contentType = (response.headers.get("content-type") || "application/octet-stream").toLowerCase();
  if (contentType.includes("text/html") || /^\s*</.test(head)) throw new Error("invalid_payload");
  if ((filename.toLowerCase().endsWith(".pdf") || contentType.includes("application/pdf")) && !head.startsWith("%PDF")) throw new Error("invalid_payload");
  if (/\.(docx|xlsx|pptx|zip)$/i.test(filename) && !head.startsWith("PK")) throw new Error("invalid_payload");
  let total = first.value.byteLength;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(first.value!);
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          if (!next.value) continue;
          total += next.value.byteLength;
          if (total > MAX_STREAM_BYTES) {
            await reader.cancel();
            controller.error(new Error("too_large_1gb"));
            return;
          }
          controller.enqueue(next.value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() { void reader.cancel(); },
  });
  return { stream, contentType, getBytes: () => total };
}

async function acquireLarge(row: LargeDocumentRow) {
  const sql = getSql();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  try {
    const response = await fetchDocument(row, controller.signal);
    if (!response.ok) throw new Error(`http_${response.status}`);
    const filename = safeFilename(filenameFromDisposition(response.headers.get("content-disposition")) || row.filename);
    const family = row.source_family === "sled" ? "sled" : "sam";
    const pathname = `${family}/${row.opportunity_id}/${row.id}/${filename}`;
    const streamed = await streamForBlob(response, filename);
    const blob = await put(pathname, streamed.stream, {
      access: "private",
      contentType: streamed.contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      multipart: true,
      abortSignal: controller.signal,
    });
    const bytes = streamed.getBytes();
    await sql.query(`update opportunity_documents set filename=$2,storage_key=$3,fetched_at=now(),extraction_status='fetched' where id=$1::uuid`, [row.id, filename, blob.pathname]);
    await sql.query(`update document_jobs set state='done',attempts=least(attempts,max_attempts),leased_until=null,lease_owner=null,last_error=null,updated_at=now() where id=$1::bigint`, [row.job_id]);
    if (/\.pdf$/i.test(filename)) {
      await sql.query(`insert into document_jobs(document_id,stage,host_class,priority,state,attempts,max_attempts,run_after,meta) values($1::uuid,'extract',$2,$3,'pending',0,5,now(),$4::jsonb) on conflict(document_id,stage) do update set state=case when document_jobs.state='done' then 'done' else 'pending' end,attempts=case when document_jobs.state='done' then document_jobs.attempts else 0 end,run_after=now(),last_error=null,meta=coalesce(document_jobs.meta,'{}'::jsonb)||excluded.meta,updated_at=now()`, [row.id, row.host_class, row.priority, JSON.stringify({ ...(row.meta || {}), bytes, reason: "large_stream_recovery" })]);
    }
    return { ok: true, documentId: row.id, bytes, filename };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql.query(`update document_jobs set state='dead',leased_until=null,lease_owner=null,last_error=$2,updated_at=now() where id=$1::bigint`, [row.job_id, message.slice(0, 1000)]);
    return { ok: false, documentId: row.id, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const unauthorized = requireInternalAuth(request);
  if (unauthorized) return unauthorized;
  if (!process.env.BLOB_STORE_ID) return NextResponse.json({ ok: false, error: "BLOB_STORE_ID unavailable" }, { status: 503 });
  const sql = getSql();
  const rows = await sql.query(`select j.id::text job_id,d.id::text,d.opportunity_id::text,d.source_url,o.source_url opportunity_source_url,d.filename,s.source_family,j.host_class,j.priority,j.meta from document_jobs j join opportunity_documents d on d.id=j.document_id join opportunities o on o.id=d.opportunity_id join sources s on s.id=o.source_id where j.stage='acquire' and j.state in ('dead','skipped') and (j.last_error in ('too_large_runtime_cap','oversize_deferred_external_processing','deferred_external_size_limit','external_processing_required:too_large_runtime_cap','too_large_200mb') or d.extraction_status='fetch_too_large') and d.storage_key is null and coalesce(d.is_missing,false)=false and o.status='open' and (o.due_at is null or o.due_at>=now()) order by j.priority,o.due_at asc nulls last,j.id limit 1`) as LargeDocumentRow[];
  if (!rows.length) return NextResponse.json({ ok: true, processed: 0, message: "No oversized public acquisition jobs remain" });
  const result = await acquireLarge(rows[0]);
  return NextResponse.json({ ok: result.ok, processed: 1, result }, { status: result.ok ? 200 : 207 });
}
