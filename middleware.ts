import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok:false, error:"CRON_SECRET is not configured" }, { status:503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok:false, error:"Unauthorized" }, { status:401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/cron/:path*",
    "/api/documents/acquire",
    "/api/documents/analyze-all",
    "/api/documents/analyze",
    "/api/documents/discover",
    "/api/documents/extract",
    "/api/documents/ionwave-sync",
    "/api/documents/jaggaer-refresh",
    "/api/documents/opengov-sync",
    "/api/documents/sam-discover",
    "/api/ingest/:path*",
    "/api/internal/:path*",
  ],
};
