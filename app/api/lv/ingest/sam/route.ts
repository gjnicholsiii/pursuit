import { NextRequest, NextResponse } from "next/server";
import { discoverSamLV } from "@/lib/lv-sam";
import { lowVoltageDatabaseConfigured, persistLVPursuit, persistLVSignal } from "@/lib/lv-persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const limit = Math.max(1, Math.min(300, Number(request.nextUrl.searchParams.get("limit") || 300)));
  const offset = Math.max(0, Number(request.nextUrl.searchParams.get("offset") || 0));
  const days = Math.max(1, Math.min(365, Number(request.nextUrl.searchParams.get("days") || 30)));
  const persist = request.nextUrl.searchParams.get("persist") === "1";

  const result = await discoverSamLV(limit, offset, days);
  let persistedSignals = 0;
  let persistedPursuits = 0;

  if (persist && lowVoltageDatabaseConfigured()) {
    for (const item of result.signals) {
      const stored = await persistLVSignal(item.opportunity, item.classification, "planning_mention");
      if (stored.stored) persistedSignals += 1;
    }
    for (const item of result.pursuits) {
      const stored = await persistLVPursuit(item.opportunity, item.classification);
      if (stored.stored) persistedPursuits += 1;
    }
  }

  const summarize = (item: (typeof result.pursuits)[number]) => ({
    externalId: item.opportunity.externalId,
    agency: item.opportunity.agency.name,
    title: item.opportunity.title,
    state: item.opportunity.stateCode,
    dueAt: item.opportunity.dueAt,
    sourceUrl: item.opportunity.sourceUrl,
    score: item.classification.score,
    disciplines: item.classification.disciplines,
    manufacturers: item.classification.manufacturers,
  });

  return NextResponse.json({
    configured: result.configured,
    databaseConfigured: lowVoltageDatabaseConfigured(),
    naics: "naics" in result ? result.naics : [],
    totalRecords: result.totalRecords,
    scanned: result.scanned,
    descriptionsFetched: "descriptionsFetched" in result ? result.descriptionsFetched : 0,
    signalsAccepted: result.signals.length,
    pursuitsAccepted: result.pursuits.length,
    rejected: result.rejected,
    persistedSignals,
    persistedPursuits,
    failures: result.failures,
    signals: result.signals.slice(0, 100).map(summarize),
    pursuits: result.pursuits.slice(0, 200).map(summarize),
  });
}
