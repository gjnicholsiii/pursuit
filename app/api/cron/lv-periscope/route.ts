import { NextResponse } from "next/server";
import { discoverPeriscopeLV, type LVPeriscopeState } from "@/lib/lv-periscope";
import { lowVoltageDatabaseConfigured, persistLVPursuit } from "@/lib/lv-persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATES: LVPeriscopeState[] = ["MA", "IL", "OR"];

export async function GET() {
  if (!lowVoltageDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "LOW_VOLTAGE_DATABASE_URL not configured" }, { status: 503 });
  }

  const state = STATES[new Date().getUTCHours() % STATES.length];
  const result = await discoverPeriscopeLV(state, 50);
  let stored = 0;
  for (const item of result.pursuits) {
    const saved = await persistLVPursuit(item.opportunity, item.classification);
    if (saved.stored) stored += 1;
  }

  return NextResponse.json({
    ok: true,
    source: result.sourceName,
    state: result.stateCode,
    scanned: result.scanned,
    accepted: result.pursuits.length,
    stored,
    complete: result.complete,
  });
}
