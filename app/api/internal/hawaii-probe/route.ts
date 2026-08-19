import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const BASE = "https://hands.ehawaii.gov/hands/";
const CHUNK = "58.ea7542805ecca7a300b7.js";

export async function GET() {
  const response = await fetch(BASE + CHUNK, {
    headers: { accept: "application/javascript,text/javascript,*/*;q=0.8", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    cache: "no-store",
  });
  const js = await response.text();
  const strings = [...new Set([...js.matchAll(/["'`]([^"'`]{2,300})["'`]/g)].map(m=>m[1]))];
  const hits = strings.filter(v => /(api|opportun|solicit|search|page|sort|status|hiepro|hands|notice)/i.test(v)).slice(0,1200);
  const needles=["http.get","http.post","handsSolicitationsCriteria","opportunit","search"];
  const contexts=needles.map(needle=>{const indexes:number[]=[];let from=0;while(indexes.length<30){const i=js.indexOf(needle,from);if(i<0)break;indexes.push(i);from=i+needle.length;}return {needle,contexts:indexes.map(i=>js.slice(Math.max(0,i-1200),i+3000))}});
  return NextResponse.json({ok:response.ok,status:response.status,length:js.length,hits,contexts});
}
