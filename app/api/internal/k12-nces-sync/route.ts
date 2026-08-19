import { NextRequest, NextResponse } from "next/server";
import { syncNcesDistrictBatch, STATE_FIPS } from "@/lib/k12/nces-districts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("debug") === "1") {
    const r = await fetch("https://nces.ed.gov/ccd/districtsearch/district_list.asp?Search=1&State=01", { cache:"no-store", headers:{"user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0"} });
    const html = await r.text();
    const i = html.toLowerCase().indexOf("district_detail.asp");
    return NextResponse.json({ status:r.status, length:html.length, index:i, fragment:i >= 0 ? html.slice(Math.max(0,i-2500), i+5000) : html.slice(0,7500) });
  }
  const statesParam = request.nextUrl.searchParams.get("states") || "AL";
  const requested = statesParam.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  const states = requested.filter(s => STATE_FIPS[s]);
  if (!states.length) return NextResponse.json({ ok:false, error:"No valid states supplied" }, { status:400 });
  try {
    const results = await syncNcesDistrictBatch(states);
    return NextResponse.json({ ok:true, results });
  } catch (error) {
    return NextResponse.json({ ok:false, error:error instanceof Error ? error.message : String(error) }, { status:500 });
  }
}
