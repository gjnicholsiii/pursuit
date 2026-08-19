import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const URLS = [
  "https://emma.maryland.gov/page.aspx/en/rfp/request_browse_public",
  "https://emma.maryland.gov/page.aspx/en/rfp/request_browse_public?__redir=true",
  "https://emma.maryland.gov/page.aspx/en/bpm/process_manage_extranet/0",
  "https://emma.maryland.gov/",
];

export async function GET() {
  const results:any[]=[];
  for (const url of URLS) {
    try {
      const r=await fetch(url,{redirect:"manual",headers:{accept:"text/html,application/xhtml+xml,*/*;q=0.8","user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0"},cache:"no-store"});
      const text=await r.text();
      const scripts=[...text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m=>m[1]).slice(0,80);
      const forms=[...text.matchAll(/<form[^>]*(?:action=["']([^"']*)["'])?[^>]*>/gi)].map(m=>m[1]||"").slice(0,20);
      results.push({url,status:r.status,location:r.headers.get("location"),contentType:r.headers.get("content-type"),length:text.length,title:(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||null,scripts,forms,sample:text.slice(0,5000)});
    } catch (e) {
      results.push({url,error:e instanceof Error?e.message:String(e)});
    }
  }
  return NextResponse.json({results});
}
