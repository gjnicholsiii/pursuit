import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const URL = "https://vss.ky.gov/vssprod-ext/Advantage4";

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function excerpts(source: string, needle: string, before = 1800, after = 3600, limit = 5) {
  const found: Array<{ index: number; snippet: string }> = [];
  let cursor = 0;
  while (found.length < limit) {
    const index = source.indexOf(needle, cursor);
    if (index < 0) break;
    const snippet = source.slice(Math.max(0, index - before), Math.min(source.length, index + after));
    if (!/EnterpriseSearch|getEnterpriseSearch/.test(snippet)) {
      found.push({ index, snippet: compact(snippet) });
    }
    cursor = index + needle.length;
  }
  return found;
}

export async function GET() {
  try {
    const response = await fetch(URL, {
      headers: { accept: "text/html,*/*", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Kentucky VSS returned ${response.status}`);
    const html = await response.text();
    const $ = load(html);
    const base = $("base").attr("href") || response.url;
    const src = $("script[src*='advjs/app.']").first().attr("src");
    if (!src) throw new Error("Advantage app bundle was not found");
    const scriptUrl = new globalThis.URL(src, base).toString();
    const scriptResponse = await fetch(scriptUrl, {
      headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
      cache: "no-store",
    });
    if (!scriptResponse.ok) throw new Error(`Advantage bundle returned ${scriptResponse.status}`);
    const source = await scriptResponse.text();

    const patterns = [
      "onPageActionClick:this.",
      "onPageActionClick=",
      "onPageActionClick:",
      "GridPagination",
      "pageActionCode",
      "paginationAction",
      'case"nextpage"',
      'case "nextpage"',
      'actionCode:"nextpage"',
      'actionCode=t',
      "rows_requested",
      "start_data_window",
    ];

    return NextResponse.json({
      ok: true,
      scriptUrl,
      matches: Object.fromEntries(patterns.map(pattern => [pattern, excerpts(source, pattern)])),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
