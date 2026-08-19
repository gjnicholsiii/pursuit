import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const url = "https://houstonisd.ionwave.net/SourcingEvents.aspx?SourceType=1";
  const response = await fetch(url, { cache: "no-store", headers: { "user-agent": "Pursuit/1.0 procurement-opportunity indexer" } });
  const html = await response.text();
  const needles = ["26-04-36", "rgBidList", "RowClick", "OnRow", "SourcingEvent", "View Bid", "ClientSettings", "grid_View"];
  const samples: Record<string, string> = {};
  for (const needle of needles) {
    const at = html.indexOf(needle);
    samples[needle] = at >= 0 ? html.slice(Math.max(0, at - 1200), at + 3000) : "NOT_FOUND";
  }
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1])
    .filter(s => /rgBidList|SourcingEvent|RowClick|grid_View/i.test(s))
    .slice(0, 20);
  return NextResponse.json({ status: response.status, length: html.length, samples, scripts });
}
