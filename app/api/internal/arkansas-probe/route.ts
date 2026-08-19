import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const TARGETS = [
  "https://sas.arkansas.gov/procurement/",
  "https://arbuy.arkansas.gov/bso/",
  "https://www.arkansas.gov/tss/procurement/bids/index.php",
];

export async function GET() {
  const results = [];
  for (const url of TARGETS) {
    try {
      const response = await fetch(url, { headers: { accept: "text/html", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, redirect: "follow", cache: "no-store" });
      const html = await response.text();
      const $ = load(html);
      const links = $("a[href]").map((_, el) => ({ text: $(el).text().replace(/\s+/g, " ").trim(), href: $(el).attr("href") || "" })).get()
        .filter(link => /ariba|bid|solicit|procure|supplier|vendor/i.test(`${link.text} ${link.href}`))
        .slice(0, 80);
      results.push({ url, status: response.status, finalUrl: response.url, title: $("title").text().trim(), links });
    } catch (error) {
      results.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
