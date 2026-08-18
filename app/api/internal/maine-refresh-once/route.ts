import { NextResponse } from "next/server";
import { syncMaineLegacyVss } from "@/lib/sled/maine";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const result = await syncMaineLegacyVss();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
