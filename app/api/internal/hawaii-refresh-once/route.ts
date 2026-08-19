import { NextResponse } from "next/server";
import { syncHawaiiHands } from "@/lib/sled/hawaii";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const result = await syncHawaiiHands();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
