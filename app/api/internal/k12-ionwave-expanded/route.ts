import { NextResponse } from "next/server";
import { discoverIonWaveK12, IONWAVE_K12_PORTALS, IONWAVE_SOURCE, type IonWavePortal } from "@/lib/sled/ionwave";
import { persistSledOpportunities } from "@/lib/sled/persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const EXTRA_PORTALS: IonWavePortal[] = [
  { key: "weslaco_isd_tx", agencyName: "Weslaco Independent School District", baseUrl: "https://wisd.ionwave.net", stateCode: "TX", city: "Weslaco", county: "Hidalgo" },
  { key: "duncanville_isd_tx", agencyName: "Duncanville Independent School District", baseUrl: "https://duncanvilleisd.ionwave.net", stateCode: "TX", city: "Duncanville", county: "Dallas" },
  { key: "aledo_isd_tx", agencyName: "Aledo Independent School District", baseUrl: "https://aledoisd.ionwave.net", stateCode: "TX", city: "Aledo", county: "Parker" },
];

export async function GET() {
  try {
    const portals = [...IONWAVE_K12_PORTALS, ...EXTRA_PORTALS];
    const discovered = await discoverIonWaveK12(portals);
    const persistence = await persistSledOpportunities(IONWAVE_SOURCE, discovered.opportunities, {
      mode: "ionwave-k12-expanded-validation",
      recordChanges: false,
      closeMissing: false,
    });
    return NextResponse.json({ ok: true, portals: portals.length, discovered: discovered.opportunities.length, stored: persistence.stored, newRecords: persistence.newRecords, changedRecords: persistence.changedRecords, diagnostics: discovered.diagnostics });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
