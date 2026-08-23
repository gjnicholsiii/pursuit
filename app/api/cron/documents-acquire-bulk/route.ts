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
  // The child acquisition route already uses bounded concurrency and SKIP LOCKED.
  // Run bulk claims sequentially so the parent invocation never fans out multiple
  // memory-heavy document buffers at once. Allow up to six claims per minute while
  // retaining the 240s execution budget; slow runs stop early and resume next minute.
  const results: Array<Awaited<ReturnType<typeof runAcquire>>> = [];
  const startedAt = Date.now();
  for (let worker = 1; worker <= 6; worker++) {
    if (Date.now() - startedAt > 240_000) break;
    const result = await runAcquire(origin, secret, worker);
    results.push(result);
    if (!result.ok) break;
  }

  return NextResponse.json({
    ok: results.length > 0 && results.every(result => result.ok),
    workers: results.length,
    results,
  });
}
