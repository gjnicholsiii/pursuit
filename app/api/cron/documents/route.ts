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

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok:false, error:"CRON_SECRET is not configured" }, { status:503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok:false, error:"Unauthorized" }, { status:401 });

  const origin = request.nextUrl.origin;
  const results=[] as Array<Record<string,unknown>>;

  results.push(await run(origin, "/api/documents/opengov-sync", secret));
  results.push(await run(origin, "/api/documents/ionwave-sync", secret));
  results.push(await run(origin, "/api/documents/discover", secret));

  // Acquisition is the dominant live backlog, so bias each cron cycle toward fetches
  // while retaining enough downstream capacity to prevent extraction/analysis starvation.
  for (let i=0;i<6;i++) results.push(await run(origin, "/api/documents/acquire", secret));
  for (let i=0;i<4;i++) results.push(await run(origin, "/api/documents/extract", secret));
  for (let i=0;i<3;i++) results.push(await run(origin, "/api/documents/analyze-all", secret));

  return NextResponse.json({ ok:true, steps:results.length, results });
}
