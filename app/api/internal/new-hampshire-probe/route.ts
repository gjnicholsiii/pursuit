import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const targets = [
  "https://apps.das.nh.gov/NHProcurement",
  "https://apps.das.nh.gov/bidscontracts/bids.aspx",
];

export async function GET() {
  const results = [];
  for (const url of targets) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
        cache: "no-store",
      });
      const text = await response.text();
      results.push({
        url,
        status: response.status,
        location: response.headers.get("location"),
        contentType: response.headers.get("content-type"),
        length: text.length,
        sample: text.slice(0, 12000),
      });
    } catch (error) {
      results.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ results });
}
