import { discoverSamLV } from "@/lib/lv-sam";
import { persistLVPursuit, persistLVSignal } from "@/lib/lv-persistence";

export const dynamic = "force-static";

export default async function LVSamRunPage() {
  const result = await discoverSamLV(300, 0, 60);
  let storedSignals = 0;
  let storedPursuits = 0;
  let updatedSignals = 0;
  let updatedPursuits = 0;

  for (const item of result.signals) {
    const saved = await persistLVSignal(item.opportunity, item.classification, "planning_mention");
    if (saved.stored) storedSignals += 1;
    if (saved.updated) updatedSignals += 1;
  }
  for (const item of result.pursuits) {
    const saved = await persistLVPursuit(item.opportunity, item.classification);
    if (saved.stored) storedPursuits += 1;
    if (saved.updated) updatedPursuits += 1;
  }

  console.log("LV_SAM_BUILD_RUN", JSON.stringify({
    configured: result.configured,
    totalRecords: result.totalRecords,
    scanned: result.scanned,
    descriptionsFetched: "descriptionsFetched" in result ? result.descriptionsFetched : 0,
    accepted: "accepted" in result ? result.accepted : result.signals.length + result.pursuits.length,
    signals: result.signals.length,
    pursuits: result.pursuits.length,
    storedSignals,
    storedPursuits,
    updatedSignals,
    updatedPursuits,
    failures: result.failures,
  }));

  return <main>SAM LV run complete: {storedSignals} new signals, {storedPursuits} new pursuits.</main>;
}
