import { NextResponse } from "next/server";
import { syncMississippiProcurement } from "@/lib/sled/mississippi";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const result = await syncMississippiProcurement();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
