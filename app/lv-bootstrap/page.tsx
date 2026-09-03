import { discoverFederalLVContracts } from "@/lib/lv-usaspending";
import { persistLVContract } from "@/lib/lv-contract-persistence";

export const dynamic = "force-static";

export default async function LVBootstrapPage() {
  const result = await discoverFederalLVContracts(8);
  let storedContracts = 0;

  for (const contract of result.contracts) {
    const stored = await persistLVContract(contract);
    if (stored.stored) storedContracts += 1;
  }

  console.log("LV_CONTRACT_BOOTSTRAP", JSON.stringify({
    scanned: result.scanned,
    accepted: result.accepted,
    storedContracts,
    failures: result.failures,
    sample: result.contracts.slice(0, 25).map(contract => ({
      incumbent: contract.incumbent,
      agency: contract.agency,
      subAgency: contract.subAgency,
      description: contract.description,
      amount: contract.amount,
      endDate: contract.endDate,
      naics: contract.naics,
      score: contract.classification.score,
      disciplines: contract.classification.disciplines,
      rebid: contract.rebid.score,
    })),
  }));

  return (
    <main style={{ padding: 32, fontFamily: "monospace" }}>
      <h1>LV Contract Bootstrap Complete</h1>
      <p>Scanned: {result.scanned}</p>
      <p>Accepted: {result.accepted}</p>
      <p>Stored contracts: {storedContracts}</p>
    </main>
  );
}
