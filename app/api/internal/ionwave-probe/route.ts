import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const base = "https://houstonisd.ionwave.net";
  const bidId = "2354";
  const candidates = [
    `/SourcingEventDetails.aspx?BidID=${bidId}`,
    `/SourcingEvent.aspx?BidID=${bidId}`,
    `/SourcingEvents.aspx?BidID=${bidId}`,
    `/SourcingEventDetails.aspx?ID=${bidId}`,
    `/SourcingEvent.aspx?ID=${bidId}`,
    `/BidDetails.aspx?BidID=${bidId}`,
    `/BidDetails.aspx?ID=${bidId}`,
    `/SourcingEvents.aspx?SourceType=1&BidID=${bidId}`,
  ];
  const results = [];
  for (const path of candidates) {
    try {
      const r = await fetch(base + path, { redirect: "manual", cache: "no-store", headers: { "user-agent": "Pursuit/1.0 procurement-opportunity indexer" } });
      const body = await r.text();
      results.push({ path, status: r.status, location: r.headers.get("location"), length: body.length, hasBid: body.includes("26-04-36"), title: body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g," ").trim() || null, sample: body.slice(0,500) });
    } catch (error) {
      results.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ bidId, results });
}
