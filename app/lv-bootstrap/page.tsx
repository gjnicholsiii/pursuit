import { classifyLowVoltage } from "@/lib/lv-classifier";
import { persistLVPursuit } from "@/lib/lv-persistence";
import { discoverIonWaveK12 } from "@/lib/sled/ionwave";

export const dynamic = "force-static";

export default async function LVBootstrapPage() {
  const result = await discoverIonWaveK12();
  const classified = result.opportunities.map(opportunity => ({
    opportunity,
    classification: classifyLowVoltage({ title: opportunity.title, description: opportunity.description }),
  }));
  const accepted = classified.filter(item => item.classification.accepted);

  console.log("LV_IONWAVE_BOOTSTRAP", JSON.stringify({
    scanned: result.opportunities.length,
    accepted: accepted.length,
    diagnostics: result.diagnostics,
    sampleTitles: result.opportunities.slice(0, 12).map(item => item.title),
    rejectedSample: classified.filter(item => !item.classification.accepted).slice(0, 12).map(item => ({
      title: item.opportunity.title,
      score: item.classification.score,
      disciplines: item.classification.disciplines,
    })),
  }));

  let storedPursuits = 0;
  for (const item of accepted) {
    const stored = await persistLVPursuit(item.opportunity, item.classification);
    if (stored.stored) storedPursuits += 1;
  }

  console.log("LV_IONWAVE_STORED", JSON.stringify({ storedPursuits }));

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
