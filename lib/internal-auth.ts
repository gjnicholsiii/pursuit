import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireInternalAuth(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok:false, error:"CRON_SECRET is not configured" }, { status:503 });

  const authorization = request.headers.get("authorization") || "";
  if (!safeEqual(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ ok:false, error:"Unauthorized" }, { status:401 });
  }
  return null;
}
