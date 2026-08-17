import { NextRequest, NextResponse } from "next/server";
import { syncSamInventory } from "@/lib/sam";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SCHEDULE = "15 5 * * *";

function authorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const vercelSchedule = request.headers.get("x-vercel-cron-schedule");

  if (cronSecret) return authHeader === `Bearer ${cronSecret}`;
  if (vercelSchedule === SCHEDULE) return true;

  // Temporary bootstrap access for the initial production backfill.
  return request.nextUrl.searchParams.get("bootstrap") === "1";
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const isBootstrap = request.nextUrl.searchParams.get("bootstrap") === "1";
  const requestedStart = Number(request.nextUrl.searchParams.get("start") || "0");
  const startOffset = isBootstrap && Number.isFinite(requestedStart) ? Math.max(0, Math.floor(requestedStart)) : 0;

  try {
    const sync = await syncSamInventory(1000, startOffset);
    return NextResponse.json({ ok: true, sync });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "SAM inventory sync failed", startOffset },
      { status: 500 },
    );
  }
}
