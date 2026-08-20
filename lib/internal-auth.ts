import { NextRequest, NextResponse } from "next/server";

export function requireInternalAuth(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok:false, error:"CRON_SECRET is not configured" }, { status:503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok:false, error:"Unauthorized" }, { status:401 });
  }
  return null;
}
