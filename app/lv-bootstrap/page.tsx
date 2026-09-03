import { discoverSamLV } from "@/lib/lv-sam";
import { persistLVPursuit } from "@/lib/lv-persistence";

export const dynamic = "force-static";

export default async function LVBootstrapPage() {
  const result = await discoverSamLV(1000, 0, 30);
  let storedPursuits = 0;

  for (const item of result.pursuits) {
    const stored = await persistLVPursuit(item.opportunity, item.classification);
    if (stored.stored) storedPursuits += 1;
  }

  console.log("LV_SAM_BOOTSTRAP", JSON.stringify({
    configured: result.configured,
    totalRecords: result.totalRecords,
    scanned: result.scanned,
    accepted: result.pursuits.length,
    rejected: result.rejected,
    storedPursuits,
    error: "error" in result ? result.error : undefined,
    sample: result.pursuits.slice(0, 25).map(item => ({
      agency: item.opportunity.agency.name,
      title: item.opportunity.title,
      score: item.classification.score,
      disciplines: item.classification.disciplines,
      manufacturers: item.classification.manufacturers,
    })),
  }));

  return (
    <main style={{ padding: 32, fontFamily: "monospace" }}>
      <h1>LV SAM Bootstrap Complete</h1>
      <p>Configured: {String(result.configured)}</p>
      <p>Scanned: {result.scanned}</p>
      <p>Accepted: {result.pursuits.length}</p>
      <p>Stored pursuits: {storedPursuits}</p>
    </main>
  );
}
