import { NextRequest, NextResponse } from "next/server";
import { syncPeriscopeFirstPages } from "@/lib/sled/periscope";
import { syncJaggaerFirstPages } from "@/lib/sled/jaggaer";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (request.headers.get("host") !== "pursuit-neon.vercel.app") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const [periscope, jaggaer] = await Promise.all([
    syncPeriscopeFirstPages(),
    syncJaggaerFirstPages(),
  ]);
  const failures = [...periscope, ...jaggaer].filter(result => !result.ok);
  return NextResponse.json({ ok: failures.length === 0, periscope, jaggaer, failures }, { status: failures.length === 0 ? 200 : 207 });
}
