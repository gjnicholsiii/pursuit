import { NextResponse } from "next/server";
import { discoverIonWaveK12, IONWAVE_SOURCE } from "@/lib/sled/ionwave";
import { VERIFIED_K12_IONWAVE_PORTALS } from "@/lib/k12/ionwave-portals";
import { persistSledOpportunities } from "@/lib/sled/persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const discovered = await discoverIonWaveK12(VERIFIED_K12_IONWAVE_PORTALS);
    const persistence = await persistSledOpportunities(
      IONWAVE_SOURCE,
      discovered.opportunities,
      {
        mode: "ionwave-k12",
        recordChanges: false,
        closeMissing: false,
      },
    );

    return NextResponse.json({
      ok: true,
      discovered: discovered.opportunities.length,
      stored: persistence.stored,
      newRecords: persistence.newRecords,
      changedRecords: persistence.changedRecords,
      diagnostics: discovered.diagnostics,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
