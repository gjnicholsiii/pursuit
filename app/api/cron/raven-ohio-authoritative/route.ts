import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Ohio's authoritative public district/staff source is the OEDS Public Extract.
// It exposes Public District selection, NCES District ID, role selection, person name,
// public email and public phone. Do not fall back to another state's importer and do
// not crawl individual districts until this statewide extract path is implemented.
const SOURCE = "https://oeds.education.ohio.gov/DataExtract";

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
    sourceMode: "oeds-public-extract",
    requiredExtract: {
      organizationType: "Public District",
      districtFields: ["IRN", "NCES District ID", "Web URL"],
      personFields: ["First Name", "Last Name", "Title", "Role Status", "Email (Primary/Public)", "Phone (Primary/Public)"],
    },
    blocker: "OEDS public extract POST/export integration still required; fail closed until statewide extract is parsed and reconciled by IRN/NCES ID",
    districtsNewlyAttempted: 0,
    ohioMissingDistrictSlots: ohioMissing,
    counts,
  };

  console.error("RAVEN_OH_AUTHORITATIVE_BLOCKED", summary);
  return NextResponse.json(summary, { status: 503 });
}
