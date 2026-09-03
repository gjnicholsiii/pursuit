import { NextRequest, NextResponse } from "next/server";
import { authorizeLVCron } from "@/lib/lv-cron-auth";
import { classifyLowVoltage } from "@/lib/lv-classifier";
import { VERIFIED_K12_IONWAVE_PORTALS } from "@/lib/k12/ionwave-portals";
import { discoverIonWaveK12 } from "@/lib/sled/ionwave";
import { lowVoltageDatabaseConfigured, persistLVPursuit } from "@/lib/lv-persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const unauthorized = authorizeLVCron(request);
  if (unauthorized) return unauthorized;
  if (!lowVoltageDatabaseConfigured()) return NextResponse.json({ ok: false, error: "LOW_VOLTAGE_DATABASE_URL not configured" }, { status: 503 });

  const result = await discoverIonWaveK12(VERIFIED_K12_IONWAVE_PORTALS);
  const accepted = result.opportunities.map(opportunity => ({ opportunity, classification: classifyLowVoltage({ title: opportunity.title, description: opportunity.description }) })).filter(item => item.classification.accepted);
  let stored = 0;
  for (const item of accepted) {
    const saved = await persistLVPursuit(item.opportunity, item.classification);
    if (saved.stored) stored += 1;
  }
  return NextResponse.json({ ok: true, source: "IonWave", portals: VERIFIED_K12_IONWAVE_PORTALS.length, scanned: result.opportunities.length, accepted: accepted.length, stored, diagnostics: result.diagnostics });
}
