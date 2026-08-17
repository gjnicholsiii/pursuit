import { NextResponse } from "next/server";
import { summarizeCoverageTruth } from "@/lib/sled/coverage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await summarizeCoverageTruth()) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
