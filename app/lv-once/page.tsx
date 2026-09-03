import { classifyLowVoltage } from "@/lib/lv-classifier";
import { VERIFIED_K12_IONWAVE_PORTALS } from "@/lib/k12/ionwave-portals";
import { persistLVPursuit } from "@/lib/lv-persistence";
import { discoverIonWaveK12 } from "@/lib/sled/ionwave";

export const dynamic = "force-static";

export default async function LVOncePage() {
  const result = await discoverIonWaveK12(VERIFIED_K12_IONWAVE_PORTALS);
  const accepted = result.opportunities
    .map(opportunity => ({ opportunity, classification: classifyLowVoltage({ title: opportunity.title, description: opportunity.description }) }))
    .filter(item => item.classification.accepted);

  let stored = 0;
  for (const item of accepted) {
    const result = await persistLVPursuit(item.opportunity, item.classification);
    if (result.stored) stored += 1;
  }

  console.log("LV_IONWAVE_VERIFIED_SWEEP", JSON.stringify({
    portals: VERIFIED_K12_IONWAVE_PORTALS.length,
    scanned: result.opportunities.length,
    accepted: accepted.length,
    stored,
    diagnostics: result.diagnostics,
    sample: accepted.slice(0, 20).map(item => ({ agency: item.opportunity.agency.name, title: item.opportunity.title, score: item.classification.score, disciplines: item.classification.disciplines })),
  }));

  return <main>One-time verified IonWave sweep complete.</main>;
}
