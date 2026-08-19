import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const targets = [
  { name: "OSP", url: "https://webprocure.proactiscloud.com/wp-web-public/" },
  { name: "RIVIP", url: "https://www.purchasing.ri.gov/bidding/ExternalBidSearch.aspx" },
];

export async function GET() {
  const results = [];
  for (const target of targets) {
    try {
      const response = await fetch(target.url, {
        redirect: "follow",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
        },
        cache: "no-store",
      });
      const text = await response.text();
      results.push({
        name: target.name,
        requestedUrl: target.url,
        finalUrl: response.url,
        status: response.status,
        contentType: response.headers.get("content-type"),
        length: text.length,
        hasWebProcure: /webprocure|proactis/i.test(text),
        hasBidSearch: /bid|solicitation|rfp|rfq|external/i.test(text),
        hasLogin: /sign in|login|username|password/i.test(text),
        sample: text.slice(0, 12000),
      });
    } catch (error) {
      results.push({
        name: target.name,
        requestedUrl: target.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return NextResponse.json({ results });
}
