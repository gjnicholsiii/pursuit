import { NextResponse } from "next/server";
import { syncOklahomaPublicBids } from "@/lib/sled/oklahoma";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const result = await syncOklahomaPublicBids();
  return NextResponse.json({ result }, { status: result.ok ? 200 : 500 });
}
