import { NextRequest, NextResponse } from "next/server";
import { syncOpenGovPublic } from "@/lib/sled/opengov";
import { syncBonfirePublic } from "@/lib/sled/bonfire";
import { discoverIonWaveK12, IONWAVE_SOURCE } from "@/lib/sled/ionwave";
import { VERIFIED_K12_IONWAVE_PORTALS } from "@/lib/k12/ionwave-portals";
import { persistSledOpportunities } from "@/lib/sled/persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [openGov, bonfire, ionwaveDiscovered] = await Promise.all([
      syncOpenGovPublic(false),
      syncBonfirePublic(),
      discoverIonWaveK12(VERIFIED_K12_IONWAVE_PORTALS),
    ]);
    const ionwave = await persistSledOpportunities(IONWAVE_SOURCE, ionwaveDiscovered.opportunities, {
      mode: "ionwave-k12-cron",
      recordChanges: false,
      closeMissing: false,
    });
    return NextResponse.json({ ok: true, sync: { openGov, bonfire, ionwave, ionwaveDiagnostics: ionwaveDiscovered.diagnostics } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "OpenGov/Bonfire/K12 refresh failed" },
      { status: 500 },
    );
  }
}
