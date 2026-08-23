import { NextRequest, NextResponse } from "next/server";

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

  // Keep extraction and analysis in separate serverless invocations. Importing and
  // executing both workers inside this parent retained their PDF/text working sets in
  // one process and caused avoidable OOM kills during heavy document drains.
  const origin = workerOrigin(request);
  const results: Array<{ path: string; status: number; ok: boolean; body: unknown }> = [];
  const startedAt = Date.now();

  const extract = await capture(origin, "/api/documents/extract", secret);
  results.push(extract);

  // Do not start another heavy worker if extraction failed or consumed almost all of
  // the parent budget. The next minute's cron resumes safely from the queue.
  if (extract.ok && Date.now() - startedAt < 240_000) {
    results.push(await capture(origin, "/api/documents/analyze-all", secret));
  }

  return NextResponse.json({
    ok: results.length > 0 && results.every(result => result.ok),
    steps: results.length,
    results,
  });
}
