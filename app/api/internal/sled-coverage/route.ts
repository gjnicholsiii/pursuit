import { NextRequest, NextResponse } from "next/server";
import { summarizeCoverageTruth } from "@/lib/sled/coverage";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireInternalAuth(request);
  if (auth) return auth;

  try {
    return NextResponse.json({ ok: true, ...(await summarizeCoverageTruth()) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
