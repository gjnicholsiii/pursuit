import { NextRequest, NextResponse } from "next/server";
import { probePublicPeopleSoft, syncPublicPeopleSoft } from "@/lib/sled/peoplesoft";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (request.headers.get("host") !== "pursuit-neon.vercel.app") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const states = await probePublicPeopleSoft();
  const shouldSync = request.nextUrl.searchParams.get("sync") === "1";
  if (!shouldSync) {
    return NextResponse.json({ ok: states.some(state => state.ok), states });
  }

  const sync = await syncPublicPeopleSoft();
  return NextResponse.json({ ok: sync.some(state => state.ok), states, sync });
}
