import { NextRequest, NextResponse } from "next/server";
import { syncOfficialStatePages } from "@/lib/sled/official-state-pages";
import { syncPeriscopeFullSweeps } from "@/lib/sled/periscope";
import { syncJaggaerFullSweeps } from "@/lib/sled/jaggaer";
import { syncCgiAdvantageFullSweeps } from "@/lib/sled/cgi-advantage";
import { syncPublicPeopleSoft } from "@/lib/sled/peoplesoft";
import { syncKansasPeopleSoft } from "@/lib/sled/kansas";
import { syncDelawareOpenBids } from "@/lib/sled/delaware";
import { syncMaineLegacyVss } from "@/lib/sled/maine";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [official, periscope, jaggaer, cgiAdvantage, peoplesoft, kansas, delaware, maine] = await Promise.all([
    syncOfficialStatePages(false),
    syncPeriscopeFullSweeps(),
    syncJaggaerFullSweeps(),
    syncCgiAdvantageFullSweeps(),
    syncPublicPeopleSoft(),
    syncKansasPeopleSoft(),
    syncDelawareOpenBids(false),
    syncMaineLegacyVss(),
  ]);

  // The reusable CGI connector still probes Maine's incompatible legacy endpoint.
  // Maine's authoritative result is the dedicated AltSelfService connector below.
  const failures = [
    ...official,
    ...periscope,
    ...jaggaer,
    ...cgiAdvantage.filter(result => result.stateCode !== "ME"),
    ...peoplesoft,
    kansas,
    delaware,
    maine,
  ].filter(result => !result.ok);

  // Keep partial SLED failures visible in Vercel runtime logs so the next sweep can
  // repair the specific connector/source instead of treating every 207 as opaque.
  if (failures.length > 0) {
    console.warn("SLED_STATE_PAGES_PARTIAL", JSON.stringify(failures));
  }

  return NextResponse.json({
    ok: failures.length === 0,
    sync: { official, periscope, jaggaer, cgiAdvantage, peoplesoft, kansas, delaware, maine },
    failures,
  }, { status: failures.length === 0 ? 200 : 207 });
}
