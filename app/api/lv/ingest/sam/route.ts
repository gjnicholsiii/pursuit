import { NextRequest, NextResponse } from "next/server";
import { discoverSamLV } from "@/lib/lv-sam";
import { lowVoltageDatabaseConfigured, persistLVPursuit } from "@/lib/lv-persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const limit = Math.max(1, Math.min(1000, Number(request.nextUrl.searchParams.get("limit") || 500)));
  const offset = Math.max(0, Number(request.nextUrl.searchParams.get("offset") || 0));
  const days = Math.max(1, Math.min(365, Number(request.nextUrl.searchParams.get("days") || 30)));
  const persist = request.nextUrl.searchParams.get("persist") === "1";

  const result = await discoverSamLV(limit, offset, days);
  let persisted = 0;

  if (persist && lowVoltageDatabaseConfigured()) {
    for (const item of result.pursuits) {
      const stored = await persistLVPursuit(item.opportunity, item.classification);
      if (stored.stored) persisted += 1;
    }
  }

  return NextResponse.json({
    configured: result.configured,
    databaseConfigured: lowVoltageDatabaseConfigured(),
    totalRecords: result.totalRecords,
    scanned: result.scanned,
    accepted: result.pursuits.length,
    rejected: result.rejected,
    persisted,
    error: "error" in result ? result.error : undefined,
    pursuits: result.pursuits.slice(0, 200).map(item => ({
      externalId: item.opportunity.externalId,
      agency: item.opportunity.agency.name,
      title: item.opportunity.title,
      state: item.opportunity.stateCode,
      dueAt: item.opportunity.dueAt,
      sourceUrl: item.opportunity.sourceUrl,
      score: item.classification.score,
      disciplines: item.classification.disciplines,
      manufacturers: item.classification.manufacturers,
    })),
  });
}
