import { NextRequest, NextResponse } from "next/server";
import { requireInternalAuth } from "@/lib/internal-auth";

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
  const authError = requireInternalAuth(request);
  if (authError) return authError;

  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });

  const origin = workerOrigin(request);
  // The child acquisition route already uses bounded concurrency and SKIP LOCKED.
  // Keep claims sequential so the parent never fans out memory-heavy document buffers.
  // Allow up to ten claims per minute during bulk SAM waves; the time guard still stops
  // slow runs before the 300-second function ceiling and resumes them next minute.
  const results: Array<Awaited<ReturnType<typeof runAcquire>>> = [];
  const startedAt = Date.now();
  for (let worker = 1; worker <= 10; worker++) {
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
