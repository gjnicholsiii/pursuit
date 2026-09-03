import { discoverOpenGovLVBatch } from "@/lib/lv-opengov";
import { persistLVPursuit, persistLVSignal } from "@/lib/lv-persistence";

export const dynamic = "force-static";

export default async function LVBootstrapPage() {
  const result = await discoverOpenGovLVBatch(0, 50);
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

  console.log("LV_OPENGOV_BOOTSTRAP", JSON.stringify({
    directorySize: result.directorySize,
    offset: result.offset,
    processed: result.processed,
    nextOffset: result.nextOffset,
    signals: result.signals.length,
    pursuits: result.pursuits.length,
    storedSignals,
    storedPursuits,
    failures: result.failures.slice(0, 10),
    signalSample: result.signals.slice(0, 10).map(item => ({
      agency: item.opportunity.agency.name,
      title: item.opportunity.title,
      score: item.classification.score,
      disciplines: item.classification.disciplines,
    })),
    pursuitSample: result.pursuits.slice(0, 10).map(item => ({
      agency: item.opportunity.agency.name,
      title: item.opportunity.title,
      score: item.classification.score,
      disciplines: item.classification.disciplines,
    })),
  }));

  return (
    <main style={{ padding: 32, fontFamily: "monospace" }}>
      <h1>LV OpenGov Bootstrap Complete</h1>
      <p>Portals processed: {result.processed}</p>
      <p>Signals: {result.signals.length}</p>
      <p>Pursuits: {result.pursuits.length}</p>
      <p>Stored signals: {storedSignals}</p>
      <p>Stored pursuits: {storedPursuits}</p>
    </main>
  );
}
