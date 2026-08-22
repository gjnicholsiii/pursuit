import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function workerOrigin(request: NextRequest) {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return productionHost ? `https://${productionHost}` : request.nextUrl.origin;
}

async function runAcquire(origin: string, secret: string, worker: number) {
  try {
    const response = await fetch(new URL("/api/documents/acquire", origin), {
      cache: "no-store",
      headers: { authorization: `Bearer ${secret}` },
    });
    let body: unknown = null;
    try { body = await response.json(); } catch { body = { status: response.status }; }
    return { worker, status: response.status, ok: response.ok, body };
  } catch (error) {
    return { worker, status: 500, ok: false, body: { error: error instanceof Error ? error.message : "worker_failed" } };
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const origin = workerOrigin(request);
  // Three independent workers claim disjoint rows via FOR UPDATE SKIP LOCKED in
  // /api/documents/acquire. This raises bulk throughput without increasing per-host
  // concurrency inside an individual worker, preserving IonWave throttling and
  // existing retry/backoff behavior.
  const results = await Promise.all([
    runAcquire(origin, secret, 1),
    runAcquire(origin, secret, 2),
    runAcquire(origin, secret, 3),
  ]);

  return NextResponse.json({
    ok: results.every(result => result.ok),
    workers: results.length,
    results,
  });
}
