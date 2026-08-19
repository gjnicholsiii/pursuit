import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const TARGETS = [
  "https://portal.ct.gov/das/ctsource/bidboard",
  "https://portal.ct.gov/das/ctsource/login",
];

export async function GET() {
  const results = [];
  for (const url of TARGETS) {
    try {
      const response = await fetch(url, {
        headers: { accept: "text/html", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
        redirect: "follow",
        cache: "no-store",
      });
      const html = await response.text();
      const $ = load(html);
      const links = $("a[href]").map((_, el) => ({ text: $(el).text().replace(/\s+/g, " ").trim(), href: $(el).attr("href") || "" })).get();
      const iframes = $("iframe[src]").map((_, el) => $(el).attr("src") || "").get();
      const scripts = $("script[src]").map((_, el) => $(el).attr("src") || "").get();
      const rawMatches = [...new Set((html.match(/https?:[^\"'<>\s]+/g) || []).filter(v => /webprocure|proactis|perfect|ctsource|bid|solicit/i.test(v)).slice(0, 80))];
      results.push({
        url,
        status: response.status,
        finalUrl: response.url,
        title: $("title").text().trim(),
        links: links.filter(link => /webprocure|proactis|perfect|bid|solicit|ctsource/i.test(`${link.text} ${link.href}`)).slice(0, 80),
        iframes,
        scripts: scripts.filter(v => /webprocure|proactis|perfect|ctsource/i.test(v)),
        rawMatches,
      });
    } catch (error) {
      results.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
