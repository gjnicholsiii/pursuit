import { NextRequest, NextResponse } from "next/server";
import { syncSamBulkFeed } from "@/lib/sam-bulk";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sync = await syncSamBulkFeed(false);
    return NextResponse.json({ ok: true, sync });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "SAM bulk refresh failed" },
      { status: 500 },
    );
  }
}
