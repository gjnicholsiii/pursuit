import { NextRequest, NextResponse } from "next/server";
import { syncPeriscopeFullSweeps } from "@/lib/sled/periscope";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const results = await syncPeriscopeFullSweeps();
    const failures = results.filter(result => !result.ok);
    if (failures.length) console.warn("SLED_PERISCOPE_PARTIAL", JSON.stringify(failures));
    return NextResponse.json({ ok: failures.length === 0, results, failures }, { status: failures.length ? 207 : 200 });
  } catch (error) {
    console.error("SLED_PERISCOPE_FAILED", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
