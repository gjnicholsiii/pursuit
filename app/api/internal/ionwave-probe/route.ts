import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const pageUrl = "https://houstonisd.ionwave.net/SourcingEvents.aspx?SourceType=1";
  const page = await fetch(pageUrl, { cache:"no-store", headers:{"user-agent":"Mozilla/5.0"} });
  const html = await page.text();
  const $ = cheerio.load(html);
  const srcs = $("script[src]").map((_,el)=>$(el).attr("src")).get().filter(Boolean) as string[];
  for (const src of srcs) {
    let absolute = src;
    try { absolute = new URL(src, pageUrl).toString(); } catch {}
    if (!/ScriptResource/i.test(absolute)) continue;
    const r = await fetch(absolute, {cache:"no-store",headers:{"user-agent":"Mozilla/5.0"}});
    const body = await r.text();
    const at = body.indexOf('"RowClick;"+itemIndex');
    if (at >= 0) {
      const clickStart = Math.max(body.lastIndexOf("_click:function", at), at - 12000);
      return NextResponse.json({ absolute, at, snippet:body.slice(clickStart, at+4000) });
    }
  }
  return NextResponse.json({error:"RowClick implementation not found"},{status:404});
}
