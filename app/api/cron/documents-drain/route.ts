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

async function batch(origin:string, path:string, secret:string, count:number) {
  return Promise.all(Array.from({length:count},()=>run(origin,path,secret)));
}

export async function GET(request:NextRequest) {
  const secret=process.env.CRON_SECRET;
  if(!secret) return NextResponse.json({ok:false,error:"CRON_SECRET is not configured"},{status:503});
  if(request.headers.get("authorization")!==`Bearer ${secret}`) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const origin=request.nextUrl.origin;
  const results=[] as Array<Record<string,unknown>>;

  // Keep this route deliberately free of discovery/platform sync work. Its only job
  // is to drain the live queue so upstream refresh latency cannot starve documents.
  results.push(...await batch(origin,"/api/documents/acquire",secret,4));
  results.push(...await batch(origin,"/api/documents/extract",secret,3));
  results.push(...await batch(origin,"/api/documents/analyze-all",secret,2));

  return NextResponse.json({ok:true,steps:results.length,results});
}
