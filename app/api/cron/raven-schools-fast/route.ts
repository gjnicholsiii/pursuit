import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const body = {
    ok: true,
    mode: "paused-exhausted-generic-district-crawler",
    attempted: 0,
    pagesScanned: 0,
    contactsFound: 0,
    candidatesPromoted: 0,
    reason: "Generic district crawling is paused after sustained zero-yield runs. Authoritative statewide Raven workers remain active and own the durable missing-slot queue so their source-exhaustion markers are not overwritten or retried.",
  };
  console.log("RAVEN_SCHOOLS_FAST_PAUSED_FOR_AUTHORITATIVE_BULK", body);
  return NextResponse.json(body);
}
