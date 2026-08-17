import { NextRequest, NextResponse } from "next/server";
import { syncOpenGovPublic } from "@/lib/sled/opengov";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const deploymentHost = process.env.VERCEL_URL;
  const requestHost = request.headers.get("host");
  if (!deploymentHost || requestHost !== deploymentHost) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const sync = await syncOpenGovPublic(true);
    return NextResponse.json({ ok: true, sync });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "OpenGov bootstrap failed" },
      { status: 500 },
    );
  }
}
