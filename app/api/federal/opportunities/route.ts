import { NextResponse } from "next/server";
import { loadSamOpportunities } from "@/lib/sam";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await loadSamOpportunities(50);

  if (!result.configured) {
    return NextResponse.json(
      {
        configured: false,
        message: "SAM_GOV_API_KEY is not configured.",
        opportunities: [],
      },
      { status: 503 },
    );
  }

  if (result.error) {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json(result);
}
