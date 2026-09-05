import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const OEDS_SOURCE = "https://oeds.education.ohio.gov/DataExtract";

export async function GET() {
  const body = {
    ok: false,
    state: "OH",
    source: OEDS_SOURCE,
    error:
      "Ohio authoritative worker disabled fail-closed: previous route incorrectly executed the Mississippi importer. Ohio must be parsed from the public OEDS DataExtract directory before database writes are allowed.",
  };

  console.error("RAVEN_OH_AUTHORITATIVE_BLOCKED", body);
  return NextResponse.json(body, { status: 503 });
}
