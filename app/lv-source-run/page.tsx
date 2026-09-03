import { discoverOpenGovLVByCodes } from "@/lib/lv-opengov";
import { persistLVPursuit, persistLVSignal } from "@/lib/lv-persistence";

export const dynamic = "force-static";

const CODES = [
  "prescott-az",
  "greenvillecounty",
  "pembrokepines",
  "coralsprings",
  "countyofdane",
  "hernandocounty",
  "dorchestercountysc",
  "daniabeachfl",
  "brevardschools",
  "santa-monica-ca",
  "akronmetro",
  "orangecountyfl",
  "ocsan",
  "pinellasfl",
  "sfoconstruction",
];

export default async function LVSourceRunPage() {
  const result = await discoverOpenGovLVByCodes(CODES);
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

  console.log("LV_OPENGOV_TARGETED_BUILD_RUN", JSON.stringify({
    requestedCodes: result.requestedCodes,
    matchedPortals: result.matchedPortals,
    missingCodes: result.missingCodes,
    projectsScanned: result.projectsScanned,
    signals: result.signals.length,
    pursuits: result.pursuits.length,
    storedSignals,
    storedPursuits,
    failures: result.failures,
    signalSample: result.signals.slice(0, 10).map(item => ({
      agency: item.opportunity.agency.name,
      title: item.opportunity.title,
      score: item.classification.score,
      disciplines: item.classification.disciplines,
    })),
    pursuitSample: result.pursuits.slice(0, 20).map(item => ({
      agency: item.opportunity.agency.name,
      title: item.opportunity.title,
      dueAt: item.opportunity.dueAt,
      score: item.classification.score,
      disciplines: item.classification.disciplines,
      manufacturers: item.classification.manufacturers,
    })),
  }));

  return <main>Targeted OpenGov LV source run complete: {storedSignals} signals, {storedPursuits} pursuits stored.</main>;
}
