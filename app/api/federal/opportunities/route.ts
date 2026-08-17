import { NextRequest, NextResponse } from "next/server";
import { getStoredFederalCount, getStoredFederalOpportunities } from "@/lib/opportunity-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || "50");
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.floor(requestedLimit), 500)) : 50;

  try {
    const [opportunities, totalRecords] = await Promise.all([
      getStoredFederalOpportunities(limit),
      getStoredFederalCount(),
    ]);

    return NextResponse.json({
      configured: true,
      source: "neon",
      opportunities,
      totalRecords,
    });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        source: "neon",
        opportunities: [],
        totalRecords: 0,
        error: error instanceof Error ? error.message : "Unable to read federal inventory",
      },
      { status: 500 },
    );
  }
}
