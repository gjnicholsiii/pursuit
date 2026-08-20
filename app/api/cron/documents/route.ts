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

async function batch(origin:string, path:string, secret:string, count:number) {
  return Promise.all(Array.from({length:count},()=>run(origin,path,secret)));
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok:false, error:"CRON_SECRET is not configured" }, { status:503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok:false, error:"Unauthorized" }, { status:401 });

  const origin = workerOrigin(request);
  const results=[] as Array<Record<string,unknown>>;

  results.push(await run(origin, "/api/documents/opengov-sync", secret));
  results.push(await run(origin, "/api/documents/ionwave-sync", secret));
  results.push(await run(origin, "/api/documents/discover", secret));

  results.push(...await batch(origin, "/api/documents/acquire", secret, 3));
  results.push(...await batch(origin, "/api/documents/extract", secret, 2));
  results.push(...await batch(origin, "/api/documents/analyze-all", secret, 2));

  return NextResponse.json({ ok:true, steps:results.length, results });
}
