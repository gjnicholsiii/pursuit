import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const url = "https://houstonisd.ionwave.net/SourcingEvents.aspx?SourceType=1";
  const response = await fetch(url, { cache: "no-store", headers: { "user-agent": "Pursuit/1.0 procurement-opportunity indexer" } });
  const html = await response.text();
  const needle = "26-04-36";
  const at = html.indexOf(needle);
  return NextResponse.json({ status: response.status, sample: at >= 0 ? html.slice(Math.max(0, at - 2500), at + 3500) : html.slice(0, 6000) });
}
