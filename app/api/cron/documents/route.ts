import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(origin:string, path:string, secret:string) {
  const response = await fetch(new URL(path, origin), {
    cache:"no-store",
    headers:{ authorization:`Bearer ${secret}` },
  });
  let body: unknown = null;
  try { body = await response.json(); } catch { body = { status:response.status }; }
  return { path, status:response.status, ok:response.ok, body };
}

async function runMany(origin:string, path:string, secret:string, count:number, concurrency:number) {
  const results=[] as Array<Record<string,unknown>>;
  for (let offset=0; offset<count; offset+=concurrency) {
    const size=Math.min(concurrency,count-offset);
    results.push(...await Promise.all(Array.from({length:size},()=>run(origin,path,secret))));
  }
  return results;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok:false, error:"CRON_SECRET is not configured" }, { status:503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok:false, error:"Unauthorized" }, { status:401 });

  const origin = request.nextUrl.origin;
  const results=[] as Array<Record<string,unknown>>;

  results.push(await run(origin, "/api/documents/opengov-sync", secret));
  results.push(await run(origin, "/api/documents/ionwave-sync", secret));
  results.push(await run(origin, "/api/documents/discover", secret));

  // Workers claim with SKIP LOCKED, so parallel invocations safely increase throughput
  // without duplicate processing. Acquisition remains the dominant live backlog.
  results.push(...await runMany(origin, "/api/documents/acquire", secret, 6, 3));
  results.push(...await runMany(origin, "/api/documents/extract", secret, 4, 2));
  results.push(...await runMany(origin, "/api/documents/analyze-all", secret, 3, 2));

  return NextResponse.json({ ok:true, steps:results.length, results });
}
