import { NextRequest, NextResponse } from "next/server";
import { syncOfficialStatePages } from "@/lib/sled/official-state-pages";
import { syncPeriscopeFirstPages } from "@/lib/sled/periscope";
import { syncJaggaerFirstPages } from "@/lib/sled/jaggaer";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [official, periscope, jaggaer] = await Promise.all([
    syncOfficialStatePages(false),
    syncPeriscopeFirstPages(),
    syncJaggaerFirstPages(),
  ]);

  const failures = [...official, ...periscope, ...jaggaer].filter(result => !result.ok);
  return NextResponse.json({
    ok: failures.length === 0,
    sync: { official, periscope, jaggaer },
    failures,
  }, { status: failures.length === 0 ? 200 : 207 });
}
