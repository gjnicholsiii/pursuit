import { NextResponse } from "next/server";
import { syncCgiAdvantageFullSweeps } from "@/lib/sled/cgi-advantage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const results = await syncCgiAdvantageFullSweeps();
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
