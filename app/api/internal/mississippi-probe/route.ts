import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const TARGET = "https://www.ms.gov/dfa/contract_bid_search/Bid?autoloadGrid=true";

export async function GET() {
  try {
    const r = await fetch(TARGET, { headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, cache: "no-store", redirect: "follow" });
    const text = await r.text();
    const scripts = [...text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
    const ajaxHints = [...text.matchAll(/(?:url|action)\s*[:=]\s*["']([^"']+)["']/gi)].map(m => m[1]).filter(x => /bid|search|grid|contract/i.test(x));
    const forms = [...text.matchAll(/<form[^>]*(?:action=["']([^"']*)["'])?[^>]*>/gi)].map(m => m[1] || "");
    return NextResponse.json({ status:r.status, finalUrl:r.url, contentType:r.headers.get("content-type"), length:text.length, scripts, ajaxHints, forms, sample:text.slice(0,20000) });
  } catch (e) {
    return NextResponse.json({ error:e instanceof Error ? e.message : String(e) }, { status:500 });
  }
}
