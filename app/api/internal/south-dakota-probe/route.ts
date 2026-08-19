import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const uid = "3444a404-3818-494f-84c5-2a850acd7779";
const endpoint = `https://postingboard.esmsolutions.com/api/postingBoard/${uid}/currentevents`;

export async function GET() {
  const url = new URL(endpoint);
  url.searchParams.set("pageNo", "0");
  url.searchParams.set("recordsPerPage", "1000");
  url.searchParams.set("browserGlobalTimeZoneNameId", "Central Standard Time");
  url.searchParams.set("browserGlobalTimeZoneName", "America/Chicago");
  url.searchParams.set("browserOffset", "-05:00:00");
  try {
    const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
    const text = await response.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch {}
    return NextResponse.json({ status: response.status, contentType: response.headers.get("content-type"), length: text.length, parsed, sample: text.slice(0, 6000) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
