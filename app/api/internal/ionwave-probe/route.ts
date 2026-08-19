import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const pageUrl = "https://houstonisd.ionwave.net/SourcingEvents.aspx?SourceType=1";
  const initial = await fetch(pageUrl, { cache:"no-store", headers:{"user-agent":"Mozilla/5.0"} });
  const html = await initial.text();
  const $ = cheerio.load(html);
  const srcs = $("script[src]").map((_,el)=>$(el).attr("src")).get().filter(Boolean) as string[];
  const matches = [];
  for (const src of srcs) {
    let absolute = src;
    try { absolute = new URL(src, pageUrl).toString(); } catch {}
    if (!/ScriptResource|WebResource/i.test(absolute)) continue;
    try {
      const r = await fetch(absolute, { cache:"no-store", headers:{"user-agent":"Mozilla/5.0"} });
      const body = await r.text();
      let start = 0;
      while (matches.length < 30) {
        const at = body.indexOf("RowClick", start);
        if (at < 0) break;
        matches.push({ absolute, at, snippet:body.slice(Math.max(0, at-1600), at+2400) });
        start = at + 8;
      }
    } catch {}
  }
  return NextResponse.json({ count:matches.length, matches });
}
