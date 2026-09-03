import { NextRequest, NextResponse } from "next/server";
import { authorizeLVCron } from "@/lib/lv-cron-auth";
import { discoverOpenGovLVBatch } from "@/lib/lv-opengov";
import { lowVoltageDatabaseConfigured, persistLVPursuit, persistLVSignal } from "@/lib/lv-persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const unauthorized = authorizeLVCron(request);
  if (unauthorized) return unauthorized;
  if (!lowVoltageDatabaseConfigured()) return NextResponse.json({ ok: false, error: "LOW_VOLTAGE_DATABASE_URL not configured" }, { status: 503 });

  const offset = new Date().getUTCHours() * 20;
  const result = await discoverOpenGovLVBatch(offset, 20);
  let storedSignals = 0;
  let storedPursuits = 0;
  for (const item of result.signals) {
    const saved = await persistLVSignal(item.opportunity, item.classification, "planning_mention");
    if (saved.stored) storedSignals += 1;
  }
  for (const item of result.pursuits) {
    const saved = await persistLVPursuit(item.opportunity, item.classification);
    if (saved.stored) storedPursuits += 1;
  }
  return NextResponse.json({ ok: result.failures.length === 0, source: "OpenGov", directorySize: result.directorySize, offset: result.offset, nextOffset: result.nextOffset, processedPortals: result.processed, signals: result.signals.length, pursuits: result.pursuits.length, storedSignals, storedPursuits, failures: result.failures.slice(0, 20) });
}
