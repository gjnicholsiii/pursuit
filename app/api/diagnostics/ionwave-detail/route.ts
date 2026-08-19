import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const url = "https://houstonisd.ionwave.net/PublicDetail.aspx?bidID=2227&SourceType=1";
  const response = await fetch(url, {
    redirect: "follow",
    cache: "no-store",
    headers: {
      "user-agent": "Pursuit/1.0 procurement document indexer",
      accept: "text/html,application/xhtml+xml,*/*",
    },
  });
  const html = await response.text();
  const $ = cheerio.load(html);
  const anchors = $("a").map((_, el) => ({
    text: $(el).text().replace(/\s+/g, " ").trim(),
    href: $(el).attr("href") || null,
    onclick: $(el).attr("onclick") || null,
    id: $(el).attr("id") || null,
  })).get().filter(a => a.href || a.onclick);
  const forms = $("form").map((_, el) => ({ id: $(el).attr("id") || null, action: $(el).attr("action") || null, method: $(el).attr("method") || null })).get();
  const inputs = $("input").map((_, el) => ({ name: $(el).attr("name") || null, value: ($(el).attr("value") || "").slice(0,200), type: $(el).attr("type") || null })).get().filter(i => /event|viewstate|bid|doc|file/i.test(`${i.name} ${i.value}`));
  const interesting = html.split(/\n/).filter(line => /attachment|document|download|file|bidpacket|addendum|radgrid|publicdetail/i.test(line)).slice(0,80).map(s => s.trim().slice(0,1000));
  return NextResponse.json({ status: response.status, finalUrl: response.url, contentType: response.headers.get("content-type"), length: html.length, title: $("title").text(), anchors: anchors.slice(0,100), forms, inputs: inputs.slice(0,50), interesting });
}
