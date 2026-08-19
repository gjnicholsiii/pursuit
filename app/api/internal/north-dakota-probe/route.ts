import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const targets = [
  "https://public.ndbuys.nd.gov/page.aspx/en/rfp/request_browse_public",
  "https://public.ndbuys.nd.gov/page.aspx/en/bas/browser_check",
];

export async function GET() {
  const results = [];
  for (const url of targets) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
        },
        cache: "no-store",
      });
      const text = await response.text();
      results.push({
        url,
        finalUrl: response.url,
        status: response.status,
        contentType: response.headers.get("content-type"),
        length: text.length,
        hasBrowserCheck: /browser_check|checking your browser/i.test(text),
        hasCaptcha: /captcha|recaptcha|grecaptcha/i.test(text),
        scripts: [...text.matchAll(/<script[^>]+src=["']([^"']+)/gi)].map(m => m[1]).slice(0,20),
        sample: text.slice(0, 10000),
      });
    } catch (error) {
      results.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ results });
}
