import { NextResponse } from "next/server";
import { syncArizonaApp } from "@/lib/sled/arizona";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const result = await syncArizonaApp();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
