import { discoverSamLV } from "@/lib/lv-sam";
import { persistLVPursuit, persistLVSignal } from "@/lib/lv-persistence";

export const dynamic = "force-static";

export default async function LVOncePage() {
  const result = await discoverSamLV(120, 0, 60);
  let storedSignals = 0;
  let storedPursuits = 0;

  for (const item of result.signals) {
    const stored = await persistLVSignal(item.opportunity, item.classification, "planning_mention");
    if (stored.stored) storedSignals += 1;
  }
  for (const item of result.pursuits) {
    const stored = await persistLVPursuit(item.opportunity, item.classification);
    if (stored.stored) storedPursuits += 1;
  }

  console.log("LV_SAM_DESCRIPTION_SWEEP", JSON.stringify({
    configured: result.configured,
    naics: "naics" in result ? result.naics : [],
    totalRecords: result.totalRecords,
    scanned: result.scanned,
    descriptionsFetched: "descriptionsFetched" in result ? result.descriptionsFetched : 0,
    signals: result.signals.length,
    pursuits: result.pursuits.length,
    storedSignals,
    storedPursuits,
    failures: result.failures,
    signalSample: result.signals.slice(0, 15).map(item => ({ agency: item.opportunity.agency.name, title: item.opportunity.title, score: item.classification.score, disciplines: item.classification.disciplines })),
    pursuitSample: result.pursuits.slice(0, 15).map(item => ({ agency: item.opportunity.agency.name, title: item.opportunity.title, score: item.classification.score, disciplines: item.classification.disciplines })),
  }));

  return <main>One-time SAM description sweep complete.</main>;
}
