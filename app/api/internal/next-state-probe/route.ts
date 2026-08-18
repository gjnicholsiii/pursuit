import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ROOT = "https://evp.nc.gov";
const PAGE = `${ROOT}/solicitations/?status=0`;

export async function GET() {
  const page = await fetch(PAGE, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    redirect: "follow",
    cache: "no-store",
  });
  const html = await page.text();
  const $ = load(html);
  const scriptUrls = [...new Set($("script[src]").toArray().map(node => $(node).attr("src") || "").filter(Boolean).map(src => {
    try { return new URL(src, ROOT).toString(); } catch { return ""; }
  }).filter(Boolean))];

  const candidates = scriptUrls.filter(url => /powerapps|portal|entity|grid|bootstrap/i.test(url)).slice(0, 40);
  const hits: Array<{ url: string; length: number; excerpts: string[] }> = [];

  const results = await Promise.allSettled(candidates.map(async url => {
    const response = await fetch(url, {
      headers: { accept: "application/javascript,text/javascript,*/*", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0", referer: PAGE },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const source = await response.text();
    const patterns = ["entity-grid-data.json", "data-get-url", "download-as-excel", "entity-grid", "selected-view"];
    const excerpts: string[] = [];
    for (const pattern of patterns) {
      let from = 0;
      while (excerpts.length < 12) {
        const index = source.indexOf(pattern, from);
        if (index < 0) break;
        excerpts.push(source.slice(Math.max(0, index - 900), Math.min(source.length, index + 1800)).replace(/\s+/g, " "));
        from = index + pattern.length;
      }
    }
    return excerpts.length ? { url, length: source.length, excerpts } : null;
  }));

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) hits.push(result.value);
  }

  return NextResponse.json({
    pageStatus: page.status,
    scriptCount: scriptUrls.length,
    candidates,
    hits,
  });
}
