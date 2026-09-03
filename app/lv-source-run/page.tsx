import { promoteCurrentLV } from "@/lib/lv-source-bridge";

export const dynamic = "force-static";

export default async function LVSourceRunPage() {
  const result = await promoteCurrentLV(40);
  console.log("LV_CURRENT_SOURCE_PROMOTION", JSON.stringify(result));
  return <main>Current LV promotion complete: {result.storedSignals} signals, {result.storedPursuits} pursuits stored.</main>;
}
