import { NextRequest, NextResponse } from "next/server";
import { syncSamBulkFeed } from "@/lib/sam-bulk";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const deploymentHost = process.env.VERCEL_URL;
  const requestHost = request.headers.get("host");

  // This temporary bootstrap can run only on its unique Vercel deployment URL,
  // which is protected by the project's Vercel deployment authentication.
  if (!deploymentHost || requestHost !== deploymentHost) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const sync = await syncSamBulkFeed(true);
    return NextResponse.json({ ok: true, sync });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "SAM bulk bootstrap failed" },
      { status: 500 },
    );
  }
}
