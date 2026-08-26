import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";

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
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // Jobs for opportunities that have already closed can never satisfy the worker
  // claim predicates. Classify them explicitly instead of leaving a permanent
  // pending tail that makes launch health look stalled forever.
  const sql = getSql();
  const stale = await sql.query(`
    with stale_jobs as (
      select j.id
      from document_jobs j
      join opportunity_documents d on d.id=j.document_id
      join opportunities o on o.id=d.opportunity_id
      where j.state='pending'
        and j.stage in ('extract','analyze')
        and not (o.status='open' and (o.due_at is null or o.due_at>=now()))
      for update skip locked
    )
    update document_jobs j
       set state='skipped',
           leased_until=null,
           lease_owner=null,
           last_error='opportunity_closed_before_document_processing',
           updated_at=now()
      from stale_jobs s
     where j.id=s.id
     returning j.id
  `);

  // Heavy extraction stays in separate serverless invocations. Four workers drain
  // safely in parallel because /api/documents/extract claims jobs with FOR UPDATE SKIP LOCKED.
  // This is launch-drain capacity; idle workers return immediately once the queue is empty.
  const origin = workerOrigin(request);
  const results: Array<{ path: string; status: number; ok: boolean; body: unknown }> = [];
  const startedAt = Date.now();

  const extracts = await Promise.all([
    capture(origin, "/api/documents/extract", secret),
    capture(origin, "/api/documents/extract", secret),
    capture(origin, "/api/documents/extract", secret),
    capture(origin, "/api/documents/extract", secret),
  ]);
  results.push(...extracts);

  // Analysis is independently claim-safe. Do not let one extraction worker failure
  // strand already-extracted documents in the analysis queue. Run analyzers whenever
  // there is enough function budget left, then report partial worker failure normally.
  if (Date.now() - startedAt < 240_000) {
    const analyses = await Promise.all([
      capture(origin, "/api/documents/analyze-all", secret),
      capture(origin, "/api/documents/analyze-all", secret),
      capture(origin, "/api/documents/analyze-all", secret),
      capture(origin, "/api/documents/analyze-all", secret),
    ]);
    results.push(...analyses);
  }

  return NextResponse.json({
    ok: results.length > 0 && results.every(result => result.ok),
    staleJobsSkipped: stale.length,
    steps: results.length,
    extractionWorkers: extracts.length,
    extractionFailures: extracts.filter(result => !result.ok).length,
    analysisWorkers: results.filter(result => result.path === "/api/documents/analyze-all").length,
    results,
  });
}
