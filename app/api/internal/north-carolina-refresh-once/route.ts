import { NextResponse } from "next/server";
import { syncNorthCarolinaEvp } from "@/lib/sled/north-carolina";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const result = await syncNorthCarolinaEvp();
    return NextResponse.json({ ok: result.ok, result }, { status: result.ok ? 200 : 207 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
