import { NextResponse } from "next/server";
import { syncVirginiaEva } from "@/lib/sled/virginia";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const result = await syncVirginiaEva();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
