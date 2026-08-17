import { NextRequest, NextResponse } from "next/server";
import { syncOfficialStatePages } from "@/lib/sled/official-state-pages";
import { syncPeriscopeFirstPages } from "@/lib/sled/periscope";
import { syncJaggaerFirstPages } from "@/lib/sled/jaggaer";
import { syncPublicPeopleSoft } from "@/lib/sled/peoplesoft";
import { syncDelawareOpenBids } from "@/lib/sled/delaware";
import { syncDirectStateBoards } from "@/lib/sled/direct-state-boards";
import { syncSouthCarolinaScbo } from "@/lib/sled/south-carolina";
import { syncTexasEsbd } from "@/lib/sled/texas";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [official, periscope, jaggaer, peoplesoft, delaware, directBoards, southCarolina, texas] = await Promise.all([
    syncOfficialStatePages(false),
    syncPeriscopeFirstPages(),
    syncJaggaerFirstPages(),
    syncPublicPeopleSoft(),
    syncDelawareOpenBids(false),
    syncDirectStateBoards(false),
    syncSouthCarolinaScbo(false),
    syncTexasEsbd(false),
  ]);

  const failures = [...official, ...periscope, ...jaggaer, ...peoplesoft, delaware, ...directBoards, southCarolina, texas].filter(result => !result.ok);
  return NextResponse.json({
    ok: failures.length === 0,
    sync: { official, periscope, jaggaer, peoplesoft, delaware, directBoards, southCarolina, texas },
    failures,
  }, { status: failures.length === 0 ? 200 : 207 });
}
