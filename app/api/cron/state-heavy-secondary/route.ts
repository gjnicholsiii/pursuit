import { NextRequest, NextResponse } from "next/server";
import { syncArkansasSasAriba } from "@/lib/sled/arkansas";
import { syncFloridaVip } from "@/lib/sled/florida";
import { syncHawaiiHands } from "@/lib/sled/hawaii";
import { syncMississippiProcurement } from "@/lib/sled/mississippi";
import { syncOklahomaPublicBids } from "@/lib/sled/oklahoma";
import { syncSouthDakotaEsm } from "@/lib/sled/south-dakota";
import { syncSouthDakotaDot } from "@/lib/sled/south-dakota-dot";
import { syncWashingtonWebs } from "@/lib/sled/washington";
import { syncWyomingReleasedBids } from "@/lib/sled/wyoming";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const [arkansas, florida, hawaii, mississippi, oklahoma, southDakotaEsm, southDakotaDot, washington, wyoming] = await Promise.all([
    syncArkansasSasAriba(), syncFloridaVip(), syncHawaiiHands(), syncMississippiProcurement(), syncOklahomaPublicBids(), syncSouthDakotaEsm(), syncSouthDakotaDot(), syncWashingtonWebs(), syncWyomingReleasedBids(),
  ]);
  const results = [arkansas, florida, hawaii, mississippi, oklahoma, southDakotaEsm, southDakotaDot, washington, wyoming];
  const failures = results.filter(result => !result.ok);
  return NextResponse.json({ ok: failures.length === 0, sync: { arkansas, florida, hawaii, mississippi, oklahoma, southDakotaEsm, southDakotaDot, washington, wyoming }, failures }, { status: failures.length === 0 ? 200 : 207 });
}
