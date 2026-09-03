import { discoverOpenGovLVBatch } from "@/lib/lv-opengov";
import { persistLVPursuit, persistLVSignal } from "@/lib/lv-persistence";

export const dynamic = "force-static";

export default async function LVBootstrapPage() {
  const offsets = [50, 100, 150, 200, 250];
  const batches = await Promise.all(offsets.map(offset => discoverOpenGovLVBatch(offset, 50)));
  const signals = batches.flatMap(batch => batch.signals);
  const pursuits = batches.flatMap(batch => batch.pursuits);

  let storedSignals = 0;
  let storedPursuits = 0;

  for (const item of signals) {
    const stored = await persistLVSignal(item.opportunity, item.classification, "planning_mention");
    if (stored.stored) storedSignals += 1;
  }

  for (const item of pursuits) {
    const stored = await persistLVPursuit(item.opportunity, item.classification);
    if (stored.stored) storedPursuits += 1;
  }

  console.log("LV_OPENGOV_SWEEP", JSON.stringify({
    offsets,
    processed: batches.reduce((sum, batch) => sum + batch.processed, 0),
    signals: signals.length,
    pursuits: pursuits.length,
    storedSignals,
    storedPursuits,
    failures: batches.flatMap(batch => batch.failures).slice(0, 20),
    signalSample: signals.slice(0, 20).map(item => ({ agency: item.opportunity.agency.name, title: item.opportunity.title, score: item.classification.score, disciplines: item.classification.disciplines })),
    pursuitSample: pursuits.slice(0, 20).map(item => ({ agency: item.opportunity.agency.name, title: item.opportunity.title, score: item.classification.score, disciplines: item.classification.disciplines })),
  }));

  return (
    <main style={{ padding: 32, fontFamily: "monospace" }}>
      <h1>LV OpenGov Sweep Complete</h1>
      <p>Portals processed: {batches.reduce((sum, batch) => sum + batch.processed, 0)}</p>
      <p>Signals: {signals.length}</p>
      <p>Pursuits: {pursuits.length}</p>
      <p>Stored signals: {storedSignals}</p>
      <p>Stored pursuits: {storedPursuits}</p>
    </main>
  );
}
