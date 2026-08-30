import { NextRequest, NextResponse } from "next/server";
import { syncNcesDistrictBatch, STATE_FIPS } from "@/lib/k12/nces-districts";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const auth = requireInternalAuth(request);
  if (auth) return auth;

  const statesParam = request.nextUrl.searchParams.get("states") || "";
  const requested = statesParam.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!requested.length) {
    return NextResponse.json(
      { ok:false, error:"Explicit states are required; national reconciliation runs through the bulk sharded NCES worker." },
      { status:400 },
    );
  }
  const states = [...new Set(requested.filter(s => STATE_FIPS[s]))];
  if (!states.length) return NextResponse.json({ ok:false, error:"No valid states supplied" }, { status:400 });
  try {
    const results = await syncNcesDistrictBatch(states);
    return NextResponse.json({ ok:true, results });
  } catch (error) {
    return NextResponse.json({ ok:false, error:error instanceof Error ? error.message : String(error) }, { status:500 });
  }
}
