import { classifyLowVoltage } from "@/lib/lv-classifier";
import { persistLVPursuit } from "@/lib/lv-persistence";
import { discoverIonWaveK12 } from "@/lib/sled/ionwave";

export const dynamic = "force-static";

export default async function LVBootstrapPage() {
  const result = await discoverIonWaveK12();
  const accepted = result.opportunities
    .map(opportunity => ({
      opportunity,
      classification: classifyLowVoltage({ title: opportunity.title, description: opportunity.description }),
    }))
    .filter(item => item.classification.accepted);

  let storedPursuits = 0;
  for (const item of accepted) {
    const stored = await persistLVPursuit(item.opportunity, item.classification);
    if (stored.stored) storedPursuits += 1;
  }

  return (
    <main style={{ padding: 32, fontFamily: "monospace" }}>
      <h1>LV IonWave Bootstrap Complete</h1>
      <p>Scanned: {result.opportunities.length}</p>
      <p>Accepted: {accepted.length}</p>
      <p>Stored pursuits: {storedPursuits}</p>
      <p>Portal diagnostics: {result.diagnostics.length}</p>
    </main>
  );
}
