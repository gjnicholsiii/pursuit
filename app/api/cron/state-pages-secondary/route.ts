import { NextRequest, NextResponse } from "next/server";
import { syncPublicPeopleSoft } from "@/lib/sled/peoplesoft";
import { syncKansasPeopleSoft } from "@/lib/sled/kansas";
import { syncDelawareOpenBids } from "@/lib/sled/delaware";
import { syncMaineLegacyVss } from "@/lib/sled/maine";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [peoplesoft, kansas, delaware, maine] = await Promise.all([
    syncPublicPeopleSoft(),
    syncKansasPeopleSoft(),
    syncDelawareOpenBids(false),
    syncMaineLegacyVss(),
  ]);

  const failures = [
    ...peoplesoft,
    kansas,
    delaware,
    maine,
  ].filter(result => !result.ok);

  if (failures.length > 0) {
    console.warn("SLED_STATE_PAGES_SECONDARY_PARTIAL", JSON.stringify(failures));
  }

  return NextResponse.json({
    ok: failures.length === 0,
    sync: { peoplesoft, kansas, delaware, maine },
    failures,
  }, { status: failures.length === 0 ? 200 : 207 });
}
