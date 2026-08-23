import { NextRequest, NextResponse } from "next/server";
import { enrichK12Batch } from "@/lib/raven/k12-enrichment";
import { resolveK12OfficialSites } from "@/lib/raven/k12-official-site";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = requireInternalAuth(request);
  if (auth) return auth;

  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") || 9);
    const identity = await resolveK12OfficialSites(60);
    const result = await enrichK12Batch(limit);
    return NextResponse.json({ ok: true, identity, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
