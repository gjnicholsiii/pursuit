import { discoverFederalLVContracts } from "@/lib/lv-usaspending";
import { persistLVContract } from "@/lib/lv-contract-persistence";

export const dynamic = "force-static";

export default async function LVContractRunPage() {
  const result = await discoverFederalLVContracts(8);
  let stored = 0;
  let high = 0;
  let medium = 0;

  for (const contract of result.contracts) {
    const persisted = await persistLVContract(contract);
    if (persisted.stored) stored += 1;
    if (contract.rebid.score >= 80) high += 1;
    else if (contract.rebid.score >= 60) medium += 1;
  }

  console.log("LV_CONTRACT_BUILD_RUN", JSON.stringify({
    scanned: result.scanned,
    accepted: result.accepted,
    stored,
    high,
    medium,
    failures: result.failures,
    samples: result.contracts.slice(0, 20).map(c => ({
      awardId: c.awardId,
      incumbent: c.incumbent,
      agency: c.subAgency || c.agency,
      description: c.description,
      amount: c.amount,
      endDate: c.endDate,
      rebid: c.rebid,
      disciplines: c.classification.disciplines,
    })),
  }));

  return <main>LV contract load: {stored} stored from {result.accepted} accepted.</main>;
}
