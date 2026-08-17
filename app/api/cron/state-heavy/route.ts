import { NextRequest, NextResponse } from "next/server";
import { syncNebraskaBoard } from "@/lib/sled/nebraska";
import { syncLouisianaLapac } from "@/lib/sled/louisiana";
import { syncSouthCarolinaScbo } from "@/lib/sled/south-carolina";
import { syncTexasEsbd } from "@/lib/sled/texas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [nebraska, louisiana, southCarolina, texas] = await Promise.all([
    syncNebraskaBoard(false),
    syncLouisianaLapac(false),
    syncSouthCarolinaScbo(false),
    syncTexasEsbd(false),
  ]);

  const results = [nebraska, louisiana, southCarolina, texas];
  const failures = results.filter(result => !result.ok);
  return NextResponse.json({
    ok: failures.length === 0,
    sync: { nebraska, louisiana, southCarolina, texas },
    failures,
  }, { status: failures.length === 0 ? 200 : 207 });
}
