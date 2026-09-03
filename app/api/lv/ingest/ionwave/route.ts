import { NextRequest, NextResponse } from "next/server";
import { classifyLowVoltage } from "@/lib/lv-classifier";
import { VERIFIED_K12_IONWAVE_PORTALS } from "@/lib/k12/ionwave-portals";
import { discoverIonWaveK12 } from "@/lib/sled/ionwave";
import { lowVoltageDatabaseConfigured, persistLVPursuit } from "@/lib/lv-persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const persist = request.nextUrl.searchParams.get("persist") === "1";
  const result = await discoverIonWaveK12(VERIFIED_K12_IONWAVE_PORTALS);

  const accepted = result.opportunities
    .map(opportunity => ({
      opportunity,
      classification: classifyLowVoltage({ title: opportunity.title, description: opportunity.description }),
    }))
    .filter(item => item.classification.accepted);

  const stored: Array<Record<string, unknown>> = [];
  if (persist && lowVoltageDatabaseConfigured()) {
    for (const item of accepted) {
      stored.push({ externalId: item.opportunity.externalId, ...(await persistLVPursuit(item.opportunity, item.classification)) });
    }
  }

  return NextResponse.json({
    portals: VERIFIED_K12_IONWAVE_PORTALS.length,
    scanned: result.opportunities.length,
    accepted: accepted.length,
    rejected: result.opportunities.length - accepted.length,
    databaseConfigured: lowVoltageDatabaseConfigured(),
    persisted: stored.filter(item => item.stored).length,
    diagnostics: result.diagnostics,
    opportunities: accepted.map(item => ({
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
  });
}
