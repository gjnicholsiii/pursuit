import { NextRequest, NextResponse } from "next/server";
import { syncOfficialStatePages } from "@/lib/sled/official-state-pages";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (request.headers.get("host") !== "pursuit-neon.vercel.app") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const sync = await syncOfficialStatePages(true);
  return NextResponse.json({ ok: true, sync });
}
