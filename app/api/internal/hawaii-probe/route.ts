import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const BASE = "https://hands.ehawaii.gov/hands/";
const RUNTIME = "runtime.02c7fee83ed7ed908f1c.js";

export async function GET() {
  const response = await fetch(BASE + RUNTIME, {
    headers: { accept: "application/javascript,text/javascript,*/*;q=0.8", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    cache: "no-store",
  });
  const js = await response.text();
  const contexts = ["58", "lF7i", ".js"].map(needle => {
    const indexes:number[]=[]; let from=0;
    while (indexes.length < 20) { const i=js.indexOf(needle, from); if(i<0) break; indexes.push(i); from=i+needle.length; }
    return { needle, contexts:indexes.map(i=>js.slice(Math.max(0,i-500),i+1000)) };
  });
  return NextResponse.json({ ok: response.ok, status: response.status, length: js.length, contexts, head: js.slice(0,20000) });
}
