import { NextRequest, NextResponse } from "next/server";
import { discoverOpenGovLVBatch } from "@/lib/lv-opengov";
import { lowVoltageDatabaseConfigured, persistLVPursuit, persistLVSignal } from "@/lib/lv-persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const offset = Math.max(0, Number(request.nextUrl.searchParams.get("offset") || 0));
  const limit = Math.max(1, Math.min(50, Number(request.nextUrl.searchParams.get("limit") || 20)));
  const persist = request.nextUrl.searchParams.get("persist") === "1";
  const result = await discoverOpenGovLVBatch(offset, limit);

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

  return NextResponse.json({
    directorySize: result.directorySize,
    offset: result.offset,
    processedPortals: result.processed,
    nextOffset: result.nextOffset,
    databaseConfigured: lowVoltageDatabaseConfigured(),
    counts: {
      signals: result.signals.length,
      pursuits: result.pursuits.length,
      persistedSignals,
      persistedPursuits,
      failures: result.failures.length,
    },
    signals: result.signals.map(item => ({
      externalId: item.opportunity.externalId,
      agency: item.opportunity.agency.name,
      state: item.opportunity.stateCode,
      title: item.opportunity.title,
      sourceUrl: item.opportunity.sourceUrl,
      score: item.classification.score,
      disciplines: item.classification.disciplines,
      manufacturers: item.classification.manufacturers,
    })),
    pursuits: result.pursuits.map(item => ({
      externalId: item.opportunity.externalId,
      agency: item.opportunity.agency.name,
      state: item.opportunity.stateCode,
      title: item.opportunity.title,
      dueAt: item.opportunity.dueAt,
      sourceUrl: item.opportunity.sourceUrl,
      score: item.classification.score,
      disciplines: item.classification.disciplines,
      manufacturers: item.classification.manufacturers,
    })),
    failures: result.failures.slice(0, 20),
  });
}
