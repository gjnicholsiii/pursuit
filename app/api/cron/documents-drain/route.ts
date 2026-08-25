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

  // Heavy extraction stays in separate serverless invocations. Two workers can drain
  // safely in parallel because /api/documents/extract claims jobs with FOR UPDATE SKIP LOCKED.
  const origin = workerOrigin(request);
  const results: Array<{ path: string; status: number; ok: boolean; body: unknown }> = [];
  const startedAt = Date.now();

  const extracts = await Promise.all([
    capture(origin, "/api/documents/extract", secret),
    capture(origin, "/api/documents/extract", secret),
  ]);
  results.push(...extracts);

  // Analysis runs only after both extraction workers return and while enough parent
  // budget remains. The next minute's cron resumes automatically if a heavy PDF used it.
  if (extracts.every(result => result.ok) && Date.now() - startedAt < 240_000) {
    results.push(await capture(origin, "/api/documents/analyze-all", secret));
  }

  return NextResponse.json({
    ok: results.length > 0 && results.every(result => result.ok),
    steps: results.length,
    extractionWorkers: extracts.length,
    results,
  });
}
