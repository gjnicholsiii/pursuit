import { NextResponse } from "next/server";
import { syncJaggaerFullSweeps } from "@/lib/sled/jaggaer";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET() {
  const results = await syncJaggaerFullSweeps();
  const result = results.find(item => item.stateCode === "NM") || null;
  return NextResponse.json({ result, allOk: results.every(item => item.ok), results }, { status: result?.ok ? 200 : 500 });
}
