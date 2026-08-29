import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function workerOrigin(request: NextRequest) {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return productionHost ? `https://${productionHost}` : request.nextUrl.origin;
}

async function capture(origin: string, path: string, secret: string) {
  try {
    const response = await fetch(new URL(path, origin), {
      cache: "no-store",
      headers: { authorization: `Bearer ${secret}` },
    });
    let body: unknown = null;
    try { body = await response.json(); } catch { body = { status: response.status }; }
    return { path, status: response.status, ok: response.ok, body };
  } catch (error) {
    return { path, status: 500, ok: false, body: { error: error instanceof Error ? error.message : "worker_failed" } };
  }
}

export async function GET(request: NextRequest) {
  const authError = requireInternalAuth(request);
  if (authError) return authError;

  const secret = process.env.CRON_SECRET!;
  const sql = getSql();

  const repairedExtractJobs = await sql.query(`
    insert into document_jobs(document_id,stage,host_class,priority)
    select d.id,'extract',coalesce(acquire.host_class,'other'),greatest(0,coalesce(acquire.priority,100)-10)
    from opportunity_documents d
    join opportunities o on o.id=d.opportunity_id
    left join lateral (
      select j.host_class,j.priority from document_jobs j
      where j.document_id=d.id and j.stage='acquire' order by j.id desc limit 1
    ) acquire on true
    where d.extraction_status='fetched'
      and d.storage_key is not null
      and (
        lower(coalesce(d.filename,'')) like '%.pdf'
        or lower(coalesce(d.filename,'')) like '%(.pdf)%'
        or lower(coalesce(d.source_url,'')) like '%.pdf%'
      )
      and o.status in ('open','active','posted')
      and (o.due_at is null or o.due_at>=now())
    on conflict(document_id,stage) do update
      set state=case when document_jobs.state='skipped' then 'pending' else document_jobs.state end,
          run_after=case when document_jobs.state='skipped' then now() else document_jobs.run_after end,
          leased_until=case when document_jobs.state='skipped' then null else document_jobs.leased_until end,
          lease_owner=case when document_jobs.state='skipped' then null else document_jobs.lease_owner end,
          last_error=case when document_jobs.state='skipped' then null else document_jobs.last_error end,
          updated_at=case when document_jobs.state='skipped' then now() else document_jobs.updated_at end
    returning id
  `);

  const repairedAnalyzeJobs = await sql.query(`
    insert into document_jobs(document_id,stage,host_class,priority)
    select d.id,'analyze',coalesce(extract_job.host_class,'other'),greatest(0,coalesce(extract_job.priority,90)-10)
    from opportunity_documents d
    join opportunities o on o.id=d.opportunity_id
    join extracted_facts ef on ef.document_id=d.id
      and ef.fact_type='document_text_extract'
      and ef.normalized_value->>'text_storage_key' is not null
    left join lateral (
      select j.host_class,j.priority from document_jobs j
      where j.document_id=d.id and j.stage='extract' order by j.id desc limit 1
    ) extract_job on true
    where d.extraction_status='text_extracted'
      and o.status in ('open','active','posted')
      and (o.due_at is null or o.due_at>=now())
    on conflict(document_id,stage) do update
      set state=case when document_jobs.state='skipped' then 'pending' else document_jobs.state end,
          run_after=case when document_jobs.state='skipped' then now() else document_jobs.run_after end,
          leased_until=case when document_jobs.state='skipped' then null else document_jobs.leased_until end,
          lease_owner=case when document_jobs.state='skipped' then null else document_jobs.lease_owner end,
          last_error=case when document_jobs.state='skipped' then null else document_jobs.last_error end,
          updated_at=case when document_jobs.state='skipped' then now() else document_jobs.updated_at end
    returning id
  `);

  const stale = await sql.query(`
    with stale_jobs as (
      select j.id
      from document_jobs j
      join opportunity_documents d on d.id=j.document_id
      join opportunities o on o.id=d.opportunity_id
      where j.state='pending'
        and j.stage in ('extract','analyze','ocr')
        and not (o.status in ('open','active','posted') and (o.due_at is null or o.due_at>=now()))
      for update skip locked
    )
    update document_jobs j
       set state='skipped',leased_until=null,lease_owner=null,
           last_error='opportunity_closed_before_document_processing',updated_at=now()
      from stale_jobs s where j.id=s.id
     returning j.id
  `);

  const origin = workerOrigin(request);
  const results: Array<{ path: string; status: number; ok: boolean; body: unknown }> = [];
  const startedAt = Date.now();

  // OCR is deliberately one-at-a-time because it is CPU/WASM heavy. Run it beside
  // the regular extraction pool so image-only PDFs can drain without starving the
  // high-throughput native-text path.
  const firstWave = await Promise.all([
    capture(origin, "/api/documents/extract", secret),
    capture(origin, "/api/documents/extract", secret),
    capture(origin, "/api/documents/extract", secret),
    capture(origin, "/api/documents/extract", secret),
    capture(origin, "/api/documents/ocr", secret),
  ]);
  results.push(...firstWave);
  const extracts = firstWave.filter(result => result.path === "/api/documents/extract");
  const ocrWorkers = firstWave.filter(result => result.path === "/api/documents/ocr");

  if (Date.now() - startedAt < 240_000) {
    const analyses = await Promise.all([
      capture(origin, "/api/documents/analyze-all", secret),
      capture(origin, "/api/documents/analyze-all", secret),
      capture(origin, "/api/documents/analyze-all", secret),
      capture(origin, "/api/documents/analyze-all", secret),
    ]);
    results.push(...analyses);
  }

  const queueAudit = await sql.query(`
    select stage,state,count(*)::int as count
    from document_jobs group by stage,state order by stage,state
  `);
  const documentAudit = await sql.query(`
    select extraction_status,count(*)::int as count
    from opportunity_documents group by extraction_status order by extraction_status
  `);
  console.info("DOCUMENT_PIPELINE_AUDIT", { queueAudit, documentAudit });

  return NextResponse.json({
    ok: results.length > 0 && results.every(result => result.ok || result.status === 207),
    repairedExtractJobs: repairedExtractJobs.length,
    repairedAnalyzeJobs: repairedAnalyzeJobs.length,
    staleJobsSkipped: stale.length,
    steps: results.length,
    extractionWorkers: extracts.length,
    extractionFailures: extracts.filter(result => !result.ok).length,
    ocrWorkers: ocrWorkers.length,
    ocrFailures: ocrWorkers.filter(result => !result.ok && result.status !== 207).length,
    analysisWorkers: results.filter(result => result.path === "/api/documents/analyze-all").length,
    queueAudit,
    documentAudit,
    results,
  });
}
