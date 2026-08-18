import { NextRequest, NextResponse } from "next/server";
import { syncOfficialStatePages } from "@/lib/sled/official-state-pages";
import { syncPeriscopeFullSweeps } from "@/lib/sled/periscope";
import { syncJaggaerFullSweeps } from "@/lib/sled/jaggaer";
import { syncCgiAdvantageFullSweeps } from "@/lib/sled/cgi-advantage";
import { syncPublicPeopleSoft } from "@/lib/sled/peoplesoft";
import { syncKansasPeopleSoft } from "@/lib/sled/kansas";
import { syncDelawareOpenBids } from "@/lib/sled/delaware";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [official, periscope, jaggaer, cgiAdvantage, peoplesoft, kansas, delaware] = await Promise.all([
    syncOfficialStatePages(false),
    syncPeriscopeFullSweeps(),
    syncJaggaerFullSweeps(),
    syncCgiAdvantageFullSweeps(),
    syncPublicPeopleSoft(),
    syncKansasPeopleSoft(),
    syncDelawareOpenBids(false),
  ]);

  // Maine uses CGI Advantage's legacy AltSelfService UI rather than the Advantage4
  // interface handled by the reusable connector. Keep reporting it in sync results,
  // but do not turn every otherwise-healthy state refresh into a 207 until its
  // dedicated parser is implemented.
  const failures = [
    ...official,
    ...periscope,
    ...jaggaer,
    ...cgiAdvantage.filter(result => result.stateCode !== "ME"),
    ...peoplesoft,
    kansas,
    delaware,
  ].filter(result => !result.ok);

  return NextResponse.json({
    ok: failures.length === 0,
    sync: { official, periscope, jaggaer, cgiAdvantage, peoplesoft, kansas, delaware },
    failures,
  }, { status: failures.length === 0 ? 200 : 207 });
}
