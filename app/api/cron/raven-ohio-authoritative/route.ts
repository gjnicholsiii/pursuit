import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Ohio's authoritative district/staff directory is OEDS. The previous implementation
// of this route was an accidental copy of the Georgia GSSA worker and therefore
// queried and wrote GA superintendent records every time the OH cron fired.
// Fail closed until an OEDS-specific importer is wired here; never mutate another
// state's queue from this endpoint.
const SOURCE = "https://education.ohio.gov/Topics/Data/Ohio-Educational-Directory-System-OEDS";

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;

  const sql = getSql();
  const counts = (await sql.query(`
    select
      count(*)::int total,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidate,
      count(*) filter(where verification_status='missing')::int missing,
      count(*) filter(where verification_status='rejected')::int rejected
    from raven_state_contacts
  `) as any[])[0];

  const ohioMissing = (await sql.query(`
    select count(*)::int missing
    from raven_state_contacts
    where state_code='OH'
      and scope='district'
      and verification_status='missing'
  `) as any[])[0]?.missing ?? 0;

  const summary = {
    ok: false,
    state: "OH",
    source: SOURCE,
    blocker: "OEDS-specific importer required; unsafe Georgia worker removed from Ohio route",
    districtsNewlyAttempted: 0,
    ohioMissingDistrictSlots: ohioMissing,
    counts,
  };

  console.error("RAVEN_OH_AUTHORITATIVE_BLOCKED", summary);
  return NextResponse.json(summary, { status: 503 });
}
