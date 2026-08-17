import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const URL = "https://vss.ky.gov/vssprod-ext/Advantage4";

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function hits(source: string, needle: string, before = 2400, after = 7600, limit = 8) {
  const result: Array<{ index: number; snippet: string }> = [];
  let from = 0;
  while (result.length < limit) {
    const index = source.indexOf(needle, from);
    if (index < 0) break;
    result.push({ index, snippet: compact(source.slice(Math.max(0, index - before), index + after)) });
    from = index + needle.length;
  }
  return result;
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
    const scriptResponse = await fetch(scriptUrl, { headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, cache: "no-store" });
    if (!scriptResponse.ok) throw new Error(`Advantage bundle returned ${scriptResponse.status}`);
    const source = await scriptResponse.text();
    return NextResponse.json({
      ok: true,
      scriptUrl,
      onPageActionClick: hits(source, "onPageActionClick", 3000, 9000, 12),
      nextpageLiteral: hits(source, '"nextpage"', 3000, 9000, 12),
      pageActionLiteral: hits(source, 'actionType="pageAction"', 3500, 9000, 12),
      pageActionColon: hits(source, 'actionType:"pageAction"', 3500, 9000, 12),
      gridPagination: hits(source, "gridPagination", 3000, 9000, 8),
      paginationData: hits(source, "paginationData", 3000, 9000, 8),
      rowsRequested: hits(source, "rows_requested", 3000, 9000, 8),
      dataWindow: hits(source, "data_window", 3000, 9000, 8),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
