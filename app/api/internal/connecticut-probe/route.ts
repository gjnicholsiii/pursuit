import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const TARGETS = [
  "https://webprocure.proactiscloud.com/wp-web-public",
  "https://webprocure.proactiscloud.com/wp-web-public/#/bidboard",
];

export async function GET() {
  const results = [];
  for (const url of TARGETS) {
    try {
      const response = await fetch(url, {
        headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
        redirect: "follow",
        cache: "no-store",
      });
      const html = await response.text();
      const $ = load(html);
      const links = $("a[href]").map((_, el) => ({ text: $(el).text().replace(/\s+/g, " ").trim(), href: $(el).attr("href") || "" })).get();
      const scripts = $("script[src]").map((_, el) => $(el).attr("src") || "").get();
      const forms = $("form").map((_, el) => ({ action: $(el).attr("action") || "", method: $(el).attr("method") || "" })).get();
      const rawPaths = [...new Set((html.match(/(?:https?:\/\/[^\"'<>\s]+|\/[^\"'<>\s]{3,})/g) || []).filter(v => /api|bid|solicit|search|public|opportun/i.test(v)).slice(0, 150))];
      results.push({
        url,
        status: response.status,
        finalUrl: response.url,
        title: $("title").text().trim(),
        links: links.slice(0, 80),
        scripts,
        forms,
        rawPaths,
        htmlHead: html.slice(0, 12000),
      });
    } catch (error) {
      results.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
