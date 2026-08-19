import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const URL = "https://sas.arkansas.gov/procurement/bid-opportunities/";

export async function GET() {
  try {
    const response = await fetch(URL, { headers: { accept: "text/html", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, redirect: "follow", cache: "no-store" });
    const html = await response.text();
    const $ = load(html);
    const entries = $("a[href*='RfxEvent/preview/']").map((_, el) => {
      const link = $(el);
      const ancestors = link.parents().toArray().slice(0, 8).map(node => ({
        tag: node.tagName,
        id: $(node).attr("id") || null,
        className: $(node).attr("class") || null,
        text: $(node).text().replace(/\s+/g, " ").trim().slice(0, 1200),
      }));
      return { href: link.attr("href") || "", text: link.text().trim(), ancestors };
    }).get();
    return NextResponse.json({ ok: response.ok, status: response.status, count: entries.length, entries });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
