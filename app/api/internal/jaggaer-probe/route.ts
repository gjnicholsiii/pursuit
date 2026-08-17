import { NextRequest, NextResponse } from "next/server";
import { probeJaggaerStates } from "@/lib/sled/jaggaer";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (request.headers.get("host") !== "pursuit-neon.vercel.app") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const states = await probeJaggaerStates();
  return NextResponse.json({ ok: states.some(state => state.ok), states });
}
