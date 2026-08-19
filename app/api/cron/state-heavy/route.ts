import { NextRequest, NextResponse } from "next/server";
import { syncNebraskaBoard } from "@/lib/sled/nebraska";
import { syncLouisianaLapac } from "@/lib/sled/louisiana";
import { syncSouthCarolinaScbo } from "@/lib/sled/south-carolina";
import { syncTexasEsbd } from "@/lib/sled/texas";
import { syncNewYorkContractReporter } from "@/lib/sled/new-york";
import { syncCaliforniaPeopleSoft } from "@/lib/sled/california";
import { syncNorthCarolinaEvp } from "@/lib/sled/north-carolina";
import { syncVirginiaEva } from "@/lib/sled/virginia";
import { syncAlabamaStaarsVss } from "@/lib/sled/alabama";
import { syncArizonaApp } from "@/lib/sled/arizona";
import { syncArkansasSasAriba } from "@/lib/sled/arkansas";
import { syncFloridaVip } from "@/lib/sled/florida";
import { syncHawaiiHands } from "@/lib/sled/hawaii";
import { syncMississippiProcurement } from "@/lib/sled/mississippi";
import { syncOklahomaPublicBids } from "@/lib/sled/oklahoma";
import { syncSouthDakotaEsm } from "@/lib/sled/south-dakota";
import { syncSouthDakotaDot } from "@/lib/sled/south-dakota-dot";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [nebraska, louisiana, southCarolina, texas, newYork, california, northCarolina, virginia, alabama, arizona, arkansas, florida, hawaii, mississippi, oklahoma, southDakotaEsm, southDakotaDot] = await Promise.all([
    syncNebraskaBoard(false),
    syncLouisianaLapac(false),
    syncSouthCarolinaScbo(false),
    syncTexasEsbd(false),
    syncNewYorkContractReporter(),
    syncCaliforniaPeopleSoft(),
    syncNorthCarolinaEvp(),
    syncVirginiaEva(),
    syncAlabamaStaarsVss(),
    syncArizonaApp(),
    syncArkansasSasAriba(),
    syncFloridaVip(),
    syncHawaiiHands(),
    syncMississippiProcurement(),
    syncOklahomaPublicBids(),
    syncSouthDakotaEsm(),
    syncSouthDakotaDot(),
  ]);

  const results = [nebraska, louisiana, southCarolina, texas, newYork, california, northCarolina, virginia, alabama, arizona, arkansas, florida, hawaii, mississippi, oklahoma, southDakotaEsm, southDakotaDot];
  const failures = results.filter(result => !result.ok);
  return NextResponse.json({
    ok: failures.length === 0,
    sync: { nebraska, louisiana, southCarolina, texas, newYork, california, northCarolina, virginia, alabama, arizona, arkansas, florida, hawaii, mississippi, oklahoma, southDakotaEsm, southDakotaDot },
    failures,
  }, { status: failures.length === 0 ? 200 : 207 });
}
