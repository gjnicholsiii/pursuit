import { NextRequest, NextResponse } from "next/server";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CHILD_TIMEOUT_MS = 45_000;
const RUN_BUDGET_MS = 210_000;

function workerOrigin(request: NextRequest) {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return productionHost ? `https://${productionHost}` : request.nextUrl.origin;
}

async function runAcquire(origin: string, secret: string, worker: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHILD_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/api/documents/acquire", origin), {
      cache: "no-store",
      signal: controller.signal,
      headers: { authorization: `Bearer ${secret}` },
    });
    let body: unknown = null;
    try { body = await response.json(); } catch { body = { status: response.status }; }
    return { worker, status: response.status, ok: response.ok, body };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      worker,
      status: timedOut ? 504 : 500,
      ok: false,
      body: { error: timedOut ? "acquire_child_timeout" : error instanceof Error ? error.message : "worker_failed" },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  const authError = requireInternalAuth(request);
  if (authError) return authError;

  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });

  const origin = workerOrigin(request);
  // Child acquisition can encounter slow upstream hosts. Bound every child request and
  // the parent invocation so one stalled acquisition cannot consume the full Vercel
  // function lifetime and discard otherwise recoverable bulk progress.
  const results: Array<Awaited<ReturnType<typeof runAcquire>>> = [];
  const startedAt = Date.now();
  for (let worker = 1; worker <= 10; worker++) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) break;
    const result = await runAcquire(origin, secret, worker);
    results.push(result);
    if (!result.ok) break;
  }

  return NextResponse.json({
    ok: results.length > 0 && results.every(result => result.ok),
    workers: results.length,
    budgetStopped: Date.now() - startedAt > RUN_BUDGET_MS,
    results,
  });
}
