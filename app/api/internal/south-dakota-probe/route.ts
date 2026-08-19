import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const board = "https://postingboard.esmsolutions.com/3444a404-3818-494f-84c5-2a850acd7779/events";

function compact(v: string) { return v.replace(/\s+/g, " ").trim(); }

export async function GET() {
  const results: unknown[] = [];
  try {
    const response = await fetch(board, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
      },
    });
    const html = await response.text();
    const $ = load(html);
    const scripts = $("script[src]").toArray().map(el => $(el).attr("src") || "").filter(Boolean);
    const links = $("a[href]").toArray().map(el => ({ text: compact($(el).text()), href: $(el).attr("href") || "" })).slice(0, 100);
    const text = compact($("body").text());
    results.push({
      name: "ESM Posting Board",
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get("content-type"),
      length: html.length,
      title: compact($("title").text()),
      scripts,
      links,
      text: text.slice(0, 12000),
      htmlHead: html.slice(0, 12000),
    });
  } catch (error) {
    results.push({ name: "ESM Posting Board", error: error instanceof Error ? error.message : String(error) });
  }
  return NextResponse.json({ results });
}
