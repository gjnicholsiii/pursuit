import { NextRequest, NextResponse } from "next/server";
import { syncNcesDistrictBatch, STATE_FIPS } from "@/lib/k12/nces-districts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
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
