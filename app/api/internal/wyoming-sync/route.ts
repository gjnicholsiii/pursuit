import { NextResponse } from "next/server";
import { syncWyomingReleasedBids } from "@/lib/sled/wyoming";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const result = await syncWyomingReleasedBids();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
