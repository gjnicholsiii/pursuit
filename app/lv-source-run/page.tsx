import { discoverPeriscopeLV, type LVPeriscopeState } from "@/lib/lv-periscope";
import { persistLVPursuit } from "@/lib/lv-persistence";

export const dynamic = "force-static";

const STATES: LVPeriscopeState[] = ["MA", "IL", "OR"];

export default async function LVSourceRunPage() {
  const results: Array<Record<string, unknown>> = [];
  let stored = 0;

  for (const state of STATES) {
    try {
      const result = await discoverPeriscopeLV(state, 25);
      let stateStored = 0;
      for (const item of result.pursuits) {
        const persisted = await persistLVPursuit(item.opportunity, item.classification);
        if (persisted.stored) {
          stored += 1;
          stateStored += 1;
        }
      }
      results.push({
        state,
        source: result.sourceName,
        scanned: result.scanned,
        resultCount: result.resultCount,
        complete: result.complete,
        accepted: result.pursuits.length,
        stored: stateStored,
        sample: result.pursuits.slice(0, 10).map(item => ({
          agency: item.opportunity.agency.name,
          title: item.opportunity.title,
          dueAt: item.opportunity.dueAt,
          score: item.classification.score,
          disciplines: item.classification.disciplines,
        })),
      });
    } catch (error) {
      results.push({ state, error: error instanceof Error ? error.message : String(error) });
    }
  }

  console.log("LV_PERISCOPE_BUILD_RUN", JSON.stringify({ stored, results }));
  return <main>LV state source run complete: {stored} stored.</main>;
}
