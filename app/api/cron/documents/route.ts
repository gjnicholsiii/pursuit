import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function workerOrigin(request: NextRequest) {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return productionHost ? `https://${productionHost}` : request.nextUrl.origin;
}

async function run(origin:string, path:string, secret:string) {
  const response = await fetch(new URL(path, origin), {
    cache:"no-store",
    headers:{ authorization:`Bearer ${secret}` },
  });
  let body: unknown = null;
  try { body = await response.json(); } catch { body = { status:response.status }; }
  return { path, status:response.status, ok:response.ok, body };
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok:false, error:"CRON_SECRET is not configured" }, { status:503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok:false, error:"Unauthorized" }, { status:401 });

  const origin = workerOrigin(request);

  // Bulk document maintenance. Give discovery and acquisition enough wall-clock budget
  // to traverse slow public procurement portals while individual workers retain their
  // own bounded batches, retries, and source-specific throttling.
  const syncResults=await Promise.all([
    run(origin, "/api/documents/opengov-sync", secret),
    run(origin, "/api/documents/ionwave-sync", secret),
    run(origin, "/api/documents/discover", secret),
  ]);
  const workerResults=await Promise.all([
    run(origin, "/api/documents/acquire", secret),
    run(origin, "/api/documents/extract", secret),
    run(origin, "/api/documents/analyze-all", secret),
  ]);
  const results=[...syncResults,...workerResults];

  return NextResponse.json({ ok:results.every(result=>result.ok!==false), steps:results.length, results });
}
