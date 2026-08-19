import { NextResponse } from "next/server";
import { syncWashingtonWebs } from "@/lib/sled/washington";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const result = await syncWashingtonWebs();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
