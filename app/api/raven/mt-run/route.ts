import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("run") !== "nebraska-authoritative-20260907") return NextResponse.json({ok:false},{status:404});
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ok:false,error:"cron auth unavailable"},{status:500});
  const origin = req.nextUrl.origin;
  const invoke = async (path:string) => {
    const r = await fetch(`${origin}${path}`, {headers:{authorization:`Bearer ${secret}`},cache:"no-store"});
    const text = await r.text();
    let body:any; try{body=JSON.parse(text);}catch{body={text};}
    return {status:r.status,body};
  };
  const authoritative = await invoke('/api/cron/raven-nebraska-authoritative');
  const verify = authoritative.status===200 ? await invoke('/api/cron/raven-nebraska-verify-authoritative') : null;
  return NextResponse.json({ok:authoritative.status===200,authoritative,verify});
}
