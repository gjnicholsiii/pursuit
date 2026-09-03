import { discoverOpenGovLVBatch } from "@/lib/lv-opengov";
import { persistLVPursuit, persistLVSignal } from "@/lib/lv-persistence";

export const dynamic = "force-static";

export default async function LVBootstrapPage() {
  const result = await discoverOpenGovLVBatch(0, 20);
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

  return (
    <main style={{ padding: 32, fontFamily: "monospace" }}>
      <h1>LV Bootstrap Complete</h1>
      <p>Portals processed: {result.processed}</p>
      <p>Signals found: {result.signals.length}</p>
      <p>Pursuits found: {result.pursuits.length}</p>
      <p>Signals stored: {storedSignals}</p>
      <p>Pursuits stored: {storedPursuits}</p>
      <p>Failures: {result.failures.length}</p>
    </main>
  );
}
