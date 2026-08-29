import { NextRequest, NextResponse } from "next/server";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  return NextResponse.json({ ok: true, paused: true, campaign: "campus-security-advisory-v1", reason: "manual reconciliation hold" });
}
