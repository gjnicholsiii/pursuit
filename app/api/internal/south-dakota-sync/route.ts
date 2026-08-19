import { NextResponse } from "next/server";
import { syncSouthDakotaEsm } from "@/lib/sled/south-dakota";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const result = await syncSouthDakotaEsm();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
