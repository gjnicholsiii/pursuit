import { NextRequest, NextResponse } from "next/server";
import { syncOfficialStatePages } from "@/lib/sled/official-state-pages";
import { syncPeriscopeFullSweeps } from "@/lib/sled/periscope";
import { syncJaggaerFullSweeps } from "@/lib/sled/jaggaer";
import { syncCgiAdvantageFullSweeps } from "@/lib/sled/cgi-advantage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [official, periscope, jaggaer, cgiAdvantage] = await Promise.all([
    syncOfficialStatePages(false),
    syncPeriscopeFullSweeps(),
    syncJaggaerFullSweeps(),
    syncCgiAdvantageFullSweeps(),
  ]);

  // Maine's authoritative result is handled by the secondary state-page sweep.
  const failures = [
    ...official,
    ...periscope,
    ...jaggaer,
    ...cgiAdvantage.filter(result => result.stateCode !== "ME"),
  ].filter(result => !result.ok);

  if (failures.length > 0) {
    console.warn("SLED_STATE_PAGES_PARTIAL", JSON.stringify(failures));
  }

  return NextResponse.json({
    ok: failures.length === 0,
    sync: { official, periscope, jaggaer, cgiAdvantage },
    failures,
  }, { status: failures.length === 0 ? 200 : 207 });
}
