import { NextResponse } from "next/server";
import { syncFloridaVip } from "@/lib/sled/florida";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const result = await syncFloridaVip();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
