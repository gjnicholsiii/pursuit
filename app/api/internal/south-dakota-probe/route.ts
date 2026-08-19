import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const origin = "https://postingboard.esmsolutions.com";
const board = `${origin}/3444a404-3818-494f-84c5-2a850acd7779/events`;

function compact(v: string) { return v.replace(/\s+/g, " ").trim(); }

export async function GET() {
  const results: unknown[] = [];
  try {
    const response = await fetch(board, { redirect: "follow", cache: "no-store", headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
    const html = await response.text();
    const $ = load(html);
    const scriptSrc = $("script[src]").toArray().map(el => $(el).attr("src") || "").find(src => /main\.[a-f0-9]+\.js/i.test(src));
    const bundleUrl = scriptSrc ? new URL(scriptSrc, origin).toString() : null;
    let bundle: string | null = null;
    let bundleStatus: number | null = null;
    if (bundleUrl) {
      const b = await fetch(bundleUrl, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
      bundleStatus = b.status;
      bundle = await b.text();
    }
    const absoluteUrls = bundle ? Array.from(new Set(bundle.match(/https?:\\?\/\\?\/[^\"'` )]+/g) || [])).slice(0, 100) : [];
    const apiFragments = bundle ? Array.from(new Set((bundle.match(/[^\"'`]{0,100}(?:api|event|postingboard|entity)[^\"'`]{0,180}/gi) || []).map(compact))).filter(v => /api|events?/i.test(v)).slice(0, 120) : [];
    results.push({
      name: "ESM Posting Board",
      status: response.status,
      finalUrl: response.url,
      bundleUrl,
      bundleStatus,
      bundleLength: bundle?.length || 0,
      absoluteUrls,
      apiFragments,
    });
  } catch (error) {
    results.push({ name: "ESM Posting Board", error: error instanceof Error ? error.message : String(error) });
  }
  return NextResponse.json({ results });
}
