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
  const results = [];
  for (const src of srcs) {
    let absolute = src;
    try { absolute = new URL(src, pageUrl).toString(); } catch {}
    if (!/WebResource|ScriptResource|Telerik|Sourcing/i.test(absolute)) continue;
    try {
      const r = await fetch(absolute, { cache:"no-store", headers:{"user-agent":"Mozilla/5.0"} });
      const body = await r.text();
      const hits = ["RowClick","EnablePostBackOnRowClick","fireCommand","postBack","_postBack"].filter(n=>body.includes(n));
      if (hits.length) {
        const snippets: Record<string,string> = {};
        for (const hit of hits) {
          const at = body.indexOf(hit);
          snippets[hit] = body.slice(Math.max(0,at-800), at+2200);
        }
        results.push({ absolute, status:r.status, length:body.length, hits, snippets });
      }
    } catch (error) {
      results.push({ absolute, error:error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ scriptCount:srcs.length, results });
}
