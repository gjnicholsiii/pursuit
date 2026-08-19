import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const TARGETS = [
  "https://sas.arkansas.gov/procurement/",
  "https://sas.arkansas.gov/procurement/bid-opportunities/",
  "https://sas.arkansas.gov/procurement/vendor-registration-resources/",
  "https://arbuy.arkansas.gov/bso/",
];

export async function GET() {
  const results = [];
  for (const url of TARGETS) {
    try {
      const response = await fetch(url, { headers: { accept: "text/html", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, redirect: "follow", cache: "no-store" });
      const html = await response.text();
      const $ = load(html);
      const links = $("a[href]").map((_, el) => ({ text: $(el).text().replace(/\s+/g, " ").trim(), href: $(el).attr("href") || "" })).get()
        .filter(link => /ariba|bid|solicit|procure|supplier|vendor|business network/i.test(`${link.text} ${link.href}`))
        .slice(0, 120);
      const bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 6000);
      results.push({ url, status: response.status, finalUrl: response.url, title: $("title").text().trim(), links, bodyText });
    } catch (error) {
      results.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
