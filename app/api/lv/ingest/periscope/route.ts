import { NextRequest, NextResponse } from "next/server";
import { discoverPeriscopeLV, type LVPeriscopeState } from "@/lib/lv-periscope";
import { lowVoltageDatabaseConfigured, persistLVPursuit } from "@/lib/lv-persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPPORTED = new Set<LVPeriscopeState>(["MA", "IL", "OR"]);

export async function GET(request: NextRequest) {
  const requested = (request.nextUrl.searchParams.get("state") || "MA").toUpperCase() as LVPeriscopeState;
  const state = SUPPORTED.has(requested) ? requested : "MA";
  const pages = Math.max(1, Math.min(50, Number(request.nextUrl.searchParams.get("pages") || 50)));
  const persist = request.nextUrl.searchParams.get("persist") === "1";

  try {
    const result = await discoverPeriscopeLV(state, pages);
    let persisted = 0;

    if (persist && lowVoltageDatabaseConfigured()) {
      for (const item of result.pursuits) {
        const stored = await persistLVPursuit(item.opportunity, item.classification);
        if (stored.stored) persisted += 1;
      }
    }

    return NextResponse.json({
      state: result.stateCode,
      source: result.sourceName,
      scanned: result.scanned,
      sourceRowsSeen: result.sourceRowsSeen,
      resultCount: result.resultCount,
      complete: result.complete,
      accepted: result.pursuits.length,
      persisted,
      databaseConfigured: lowVoltageDatabaseConfigured(),
      pursuits: result.pursuits.slice(0, 200).map(item => ({
        externalId: item.opportunity.externalId,
        agency: item.opportunity.agency.name,
        title: item.opportunity.title,
        dueAt: item.opportunity.dueAt,
        sourceUrl: item.opportunity.sourceUrl,
        score: item.classification.score,
        disciplines: item.classification.disciplines,
        manufacturers: item.classification.manufacturers,
      })),
    });
  } catch (error) {
    return NextResponse.json({
      state,
      error: error instanceof Error ? error.message : String(error),
      databaseConfigured: lowVoltageDatabaseConfigured(),
    }, { status: 500 });
  }
}
