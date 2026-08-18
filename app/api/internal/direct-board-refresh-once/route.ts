import { NextResponse } from "next/server";
import { syncNebraskaBoard } from "@/lib/sled/nebraska";
import { syncLouisianaLapac } from "@/lib/sled/louisiana";
import { syncSouthCarolinaScbo } from "@/lib/sled/south-carolina";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const [nebraska, louisiana, southCarolina] = await Promise.all([
      syncNebraskaBoard(false),
      syncLouisianaLapac(false),
      syncSouthCarolinaScbo(false),
    ]);
    const results = [nebraska, louisiana, southCarolina];
    const failures = results.filter(result => !result.ok);
    return NextResponse.json(
      { ok: failures.length === 0, results, failures },
      { status: failures.length === 0 ? 200 : 207 },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
