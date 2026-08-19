import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const targets = [
  "https://public.ndbuys.nd.gov/",
  "https://public.ndbuys.nd.gov/page.aspx/en/rfp/request_browse_public",
  "https://internal.ndbuys.nd.gov/page.aspx/en/rfp/request_browse_public",
];

export async function GET() {
  const results = [];
  for (const url of targets) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
        },
        cache: "no-store",
      });
      const text = await response.text();
      results.push({
        url,
        status: response.status,
        location: response.headers.get("location"),
        contentType: response.headers.get("content-type"),
        length: text.length,
        hasBrowserCheck: /browser_check|checking your browser/i.test(text),
        hasCaptcha: /captcha|recaptcha/i.test(text),
        sample: text.slice(0, 6000),
      });
    } catch (error) {
      results.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ results });
}
