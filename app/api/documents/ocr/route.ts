import { get, put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import scribe from "scribe.js-ocr";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const OCR_BATCH_SIZE = 1;
// Large scans repeatedly exhaust the memory/time budget of a Vercel function. Keep
// the in-function lane deliberately small; larger scans are retained for an external
// OCR lane instead of repeatedly killing the worker and blocking the queue.
const OCR_MAX_BYTES = 12 * 1024 * 1024;
const OCR_MAX_PAGES = 20;
const MAX_EXTRACTED_CHARACTERS = 12_000_000;

type OcrJob = {
  job_id: string;
  id: string;
  opportunity_id: string;
  storage_key: string;
  host_class: string;
  priority: number;
  bytes: number;
};

async function finishJob(jobId: string) {
  const sql = getSql();
  await sql.query(
    `update document_jobs set state='done',leased_until=null,lease_owner=null,last_error=null,updated_at=now() where id=$1::bigint`,
    [jobId],
  );
}

async function retryJob(jobId: string, error: string) {
  const sql = getSql();
  await sql.query(
    `update document_jobs
        set state=case when attempts>=max_attempts then 'dead' else 'pending' end,
            run_after=now()+(interval '1 second'*least(900,power(2,attempts))),
            leased_until=null,lease_owner=null,last_error=$2,updated_at=now()
      where id=$1::bigint`,
    [jobId, error.slice(0, 1000)],
  );
}

async function deferExternal(job: OcrJob, reason: string) {
  const sql = getSql();
  await sql.query(
    `update opportunity_documents set extraction_status='external_processing_required' where id=$1::uuid`,
    [job.id],
  );
  await sql.query(
    `update document_jobs set state='done',leased_until=null,lease_owner=null,last_error=$2,updated_at=now() where id=$1::bigint`,
    [job.job_id, reason],
  );
  return { ok: false, documentId: job.id, reason, permanent: true };
}

async function processOne(job: OcrJob) {
  const sql = getSql();
  let tempPath: string | null = null;
  let doc: Awaited<ReturnType<typeof scribe.openDocument>> | null = null;
  try {
    if (Number(job.bytes) > OCR_MAX_BYTES) return await deferExternal(job, "ocr_document_too_large_for_serverless");

    const blob = await get(job.storage_key, { access: "private" });
    if (!blob || blob.statusCode !== 200 || !blob.stream) throw new Error("stored_pdf_unavailable_for_ocr");
    const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer());
    tempPath = join("/tmp", `pursuit-ocr-${job.id}.pdf`);
    await writeFile(tempPath, bytes);

    scribe.opt.workerN = 1;
    doc = await scribe.openDocument([tempPath]);
    const pageCount = Number((doc as unknown as { pageCount?: number; n?: number }).pageCount ?? (doc as unknown as { n?: number }).n ?? 0);
    if (pageCount > OCR_MAX_PAGES) return await deferExternal(job, "ocr_document_too_many_pages_for_serverless");

    await doc.recognize({ langs: ["eng"], mode: "speed" });
    const exported = await doc.exportData("text");
    const rawText = typeof exported === "string" ? exported : Buffer.from(exported).toString("utf8");
    const text = rawText.slice(0, MAX_EXTRACTED_CHARACTERS).trim();
    if (!text) throw new Error("ocr_returned_empty_text");

    const textPath = `extracted/${job.opportunity_id}/${job.id}.txt`;
    const textBlob = await put(textPath, text, { access: "private", contentType: "text/plain; charset=utf-8", addRandomSuffix: false, allowOverwrite: true });

    await sql.query(
      `insert into extracted_facts
        (opportunity_id,document_id,fact_type,normalized_value,source_text,evidence_locator,extraction_confidence)
       values($1::uuid,$2::uuid,'document_text_extract',jsonb_build_object('text_storage_key',$3::text,'character_count',$4::int,'ocr',true,'truncated',$5::boolean),null,jsonb_build_object('document_id',$2::text,'method','ocr'),0.85)
       on conflict do nothing`,
      [job.opportunity_id, job.id, textBlob.pathname, text.length, rawText.length > MAX_EXTRACTED_CHARACTERS],
    );
    await sql.query(`update opportunity_documents set extraction_status='text_extracted' where id=$1::uuid`, [job.id]);
    await sql.query(
      `insert into document_jobs(document_id,stage,host_class,priority) values($1::uuid,'analyze',$2,$3)
       on conflict(document_id,stage) do update set priority=least(document_jobs.priority,excluded.priority),state=case when document_jobs.state in ('done','leased') then document_jobs.state else 'pending' end,run_after=case when document_jobs.state in ('done','leased') then document_jobs.run_after else now() end,updated_at=now()`,
      [job.id, job.host_class, Math.max(0, job.priority - 5)],
    );
    await finishJob(job.job_id);
    return { ok: true, documentId: job.id, characters: text.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ocr_failed";
    // Scribe worker termination and malformed progress metadata are deterministic for
    // troublesome scans in this runtime. Quarantine them instead of retrying until a
    // 300s timeout/OOM and starving the rest of the OCR queue.
    if (/WorkerTerminatedError|recognitionTime|out of memory/i.test(message)) return await deferExternal(job, `ocr_serverless_incompatible: ${message}`);
    await retryJob(job.job_id, message);
    return { ok: false, documentId: job.id, reason: message };
  } finally {
    try { await doc?.terminate(); } catch {}
    try { await scribe.terminate(); } catch {}
    if (tempPath) try { await unlink(tempPath); } catch {}
  }
}

export async function GET(request: NextRequest) {
  const unauthorized = requireInternalAuth(request);
  if (unauthorized) return unauthorized;
  const sql = getSql();
  await sql.query(`update document_jobs set state=case when attempts>=max_attempts then 'dead' else 'pending' end,run_after=now()+(interval '1 second'*least(900,power(2,attempts))),leased_until=null,lease_owner=null,last_error=coalesce(last_error,'ocr lease expired'),updated_at=now() where stage='ocr' and state='leased' and leased_until<now()`);
  const owner = `vercel-ocr-${crypto.randomUUID()}`;
  const rows = await sql.query(`
    with claim as (
      select j.id from document_jobs j join opportunity_documents d on d.id=j.document_id join opportunities o on o.id=d.opportunity_id
      where j.stage='ocr' and j.state='pending' and j.run_after<=now() and d.extraction_status='text_empty' and d.storage_key is not null
        and lower(coalesce(o.status,'')) in ('open','active','posted') and (o.due_at is null or o.due_at>=now())
      order by j.priority,j.run_after,j.id limit ${OCR_BATCH_SIZE} for update skip locked
    ), leased as (
      update document_jobs j set state='leased',leased_until=now()+interval '10 minutes',lease_owner=$1,attempts=attempts+1,updated_at=now()
      from claim where j.id=claim.id returning j.id as job_id,j.document_id,j.host_class,j.priority,j.meta
    )
    select leased.job_id::text,d.id,d.opportunity_id,d.storage_key,leased.host_class,leased.priority,coalesce((leased.meta->>'bytes')::bigint,0)::bigint as bytes
    from leased join opportunity_documents d on d.id=leased.document_id`, [owner]) as OcrJob[];
  if (!rows.length) return NextResponse.json({ ok: true, processed: 0, message: "No OCR jobs are waiting" });
  const result = await processOne(rows[0]);
  return NextResponse.json({ ok: result.ok, processed: 1, result }, { status: result.ok ? 200 : 207 });
}
