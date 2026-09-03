import { NextResponse } from "next/server";
import { discoverFederalLVContracts } from "@/lib/lv-usaspending";
import { persistLVContract } from "@/lib/lv-contract-persistence";
import { lowVoltageDatabaseConfigured } from "@/lib/lv-persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  if (!lowVoltageDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "LOW_VOLTAGE_DATABASE_URL not configured" }, { status: 503 });
  }

  const result = await discoverFederalLVContracts(8);
  let stored = 0;
  for (const contract of result.contracts) {
    const saved = await persistLVContract(contract);
    if (saved.stored) stored += 1;
  }

  return NextResponse.json({
    ok: result.failures.length === 0,
    source: "USAspending",
    scanned: result.scanned,
    accepted: result.accepted,
    stored,
    failures: result.failures,
  });
}
