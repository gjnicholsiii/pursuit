import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const ose = "https://www.sd.gov/bhra?id=kb_article_view&sysparm_article=KB0044739";
const dot = "https://apps.sd.gov/HC65BidLetting/ebslettings1.aspx";
function compact(v: string) { return v.replace(/\s+/g, " ").trim(); }

async function inspect(url: string) {
  const r = await fetch(url, { redirect: "follow", cache: "no-store", headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
  const html = await r.text();
  const $ = load(html);
  const rows = $("tr").toArray().map((row,i)=>({ i, cells: $(row).find("th,td").toArray().map(c=>compact($(c).text())), links: $(row).find("a[href]").toArray().map(a=>({text:compact($(a).text()),href:$(a).attr("href")||""})) })).filter(x=>x.cells.some(Boolean)||x.links.length).slice(0,200);
  const links = $("a[href]").toArray().map(a=>({text:compact($(a).text()),href:$(a).attr("href")||""})).filter(x=>/bid|letting|proposal|advert|pdf|project|2026/i.test(`${x.text} ${x.href}`)).slice(0,200);
  return { status:r.status, finalUrl:r.url, length:html.length, title:compact($("title").text()), rows, links, body:compact($("body").text()).slice(0,20000) };
}

export async function GET() {
  const results: Record<string, unknown> = {};
  for (const [name,url] of [["ose",ose],["dot",dot]] as const) {
    try { results[name] = await inspect(url); }
    catch (error) { results[name] = { error: error instanceof Error ? error.message : String(error) }; }
  }
  return NextResponse.json(results);
}
