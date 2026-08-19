import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const START = "https://emma.maryland.gov/page.aspx/en/rfp/request_browse_public";
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

function cookiePairs(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(v=>v.split(";",1)[0]).filter(Boolean);
}
function merge(existing:string[],incoming:string[]) { const m=new Map<string,string>(); for(const p of [...existing,...incoming]){const i=p.indexOf("="); if(i>0)m.set(p.slice(0,i),p);} return [...m.values()]; }

export async function GET() {
  let url=START; let cookies:string[]=[]; const hops:any[]=[];
  for(let i=0;i<8;i++) {
    const r=await fetch(url,{redirect:"manual",headers:{accept:"text/html,application/xhtml+xml,*/*;q=0.8","user-agent":UA,...(cookies.length?{cookie:cookies.join("; ")}:{})},cache:"no-store"});
    const text=await r.text(); cookies=merge(cookies,cookiePairs(r));
    const loc=r.headers.get("location");
    hops.push({url,status:r.status,location:loc,cookies,contentType:r.headers.get("content-type"),length:text.length,title:(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||null,scripts:[...text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m=>m[1]).slice(0,40),sample:text.slice(0,8000)});
    if(!loc || r.status<300 || r.status>=400) break;
    url=new globalThis.URL(loc,url).toString();
  }
  return NextResponse.json({hops});
}
