import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const oseUrl = "https://www.sd.gov/bhra?id=kb_article_view&sysparm_article=KB0044739";
const dotIndex = "https://apps.sd.gov/HC65BidLetting/ebslettings1.aspx";
function compact(v: string) { return v.replace(/\s+/g, " ").trim(); }

function snippets(text: string, terms: string[]) {
  return terms.map(term => {
    const at = text.toLowerCase().indexOf(term.toLowerCase());
    return at < 0 ? null : { term, text: compact(text.slice(Math.max(0, at - 1200), Math.min(text.length, at + 5000))) };
  }).filter(Boolean);
}

async function fetchText(url: string) {
  const r = await fetch(url, { redirect: "follow", cache: "no-store", headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
  return { r, text: await r.text() };
}

export async function GET() {
  const ose = await fetchText(oseUrl);
  const dot = await fetchText(dotIndex);
  const $dot = load(dot.text);
  const advertised: { label:string; href:string; status?:number; title?:string; body?:string; rows?:unknown[] }[] = [];
  const marker = compact($dot("body").text());
  const section = marker.match(/Lettings Currently Advertised for Bids:(.*?)Status of Lettings Post Bid Opening:/i)?.[1] || "";
  for (const a of $dot("a[href]").toArray()) {
    const label = compact($dot(a).text());
    const href = $dot(a).attr("href") || "";
    if (!/^\w+ \d{1,2}, 2026$/.test(label) || !section.includes(label) || !/ebslettingsdetail1\.aspx/i.test(href)) continue;
    const absolute = new URL(href, dot.r.url).toString();
    const detail = await fetchText(absolute);
    const $ = load(detail.text);
    const rows = $("tr").toArray().map((row,i)=>({ i, cells:$(row).find("th,td").toArray().map(c=>compact($(c).text())), links:$(row).find("a[href]").toArray().map(x=>({text:compact($(x).text()),href:$(x).attr("href")||""})) })).filter(x=>x.cells.some(Boolean)||x.links.length).slice(0,200);
    advertised.push({ label, href:absolute, status:detail.r.status, title:compact($("title").text()), body:compact($("body").text()).slice(0,14000), rows });
  }
  return NextResponse.json({
    ose: { status:ose.r.status, length:ose.text.length, snippets:snippets(ose.text,["Campus, Windows and Doors Replacement","Veterans Cemetery","KB0044739","articleBody","sys_kb_id","knowledge"]) },
    dot: { status:dot.r.status, advertisedCount:advertised.length, advertised },
  });
}
