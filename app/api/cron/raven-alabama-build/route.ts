import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const rows = [
  {
    state_code: "AL", county: null, scope: "state", role_key: "state_security_director",
    full_name: "Dr. Johnny Whaley", title: "Education Administrator II",
    email: "johnny.whaley@alsde.edu", phone: "334-694-0166",
    source_url: "https://www.alabamaachieves.org/wp-content/uploads/2025/04/StateSuperIn_Memos_20250410_FY25-3027-School-Safety-and-nSide-Training-2025_v1.0.pdf",
    evidence_note: "ALSDE School Safety Section contact for 2025 School Safety and nSide training; current ALSDE staff page lists Education Administrator II."
  },
  {
    state_code: "AL", county: "Baldwin", scope: "district", role_key: "security_director",
    full_name: "Jeff Spaller", title: "Safety Supervisor", email: null,
    phone: "251-972-6854", source_url: "https://www.bcbe.org/departments/athletics-prevention-safety/safety",
    evidence_note: "Official Baldwin County Public Schools safety department contact."
  },
  {
    state_code: "AL", county: "Baldwin", scope: "district", role_key: "superintendent",
    full_name: "Marty McRae", title: "Superintendent", email: null,
    phone: "251-937-0308", source_url: "https://www.bcbe.org/superintendent-senior-staff/superintendent",
    evidence_note: "Official BCBE superintendent page, current 2026."
  },
  {
    state_code: "AL", county: "Baldwin", scope: "district", role_key: "assistant_superintendent",
    full_name: "Joe Sharp", title: "Assistant Superintendent, Secondary Education", email: null,
    phone: "251-970-7322", source_url: "https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-secondary-education",
    evidence_note: "Official BCBE senior staff page."
  },
  {
    state_code: "AL", county: "Baldwin", scope: "district", role_key: "it_director",
    full_name: "David Besancon, Ph.D., M.B.A.", title: "Assistant Superintendent Education Technology",
    email: "dbesancon@bcbe.org", phone: "251-937-0306", source_url: "https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-educational-technology",
    evidence_note: "Official BCBE Educational Technology leadership page and staff directory."
  },
  {
    state_code: "AL", county: "Baldwin", scope: "district", role_key: "school_board",
    full_name: "Tony Myrick", title: "BCBE Board President", email: null, phone: null,
    source_url: "https://www.bcbe.org/board-of-education/bcbe-board-members",
    evidence_note: "Official BCBE board page identifies District 3 member Tony Myrick as Board President."
  },
  {
    state_code: "AL", county: "Blount", scope: "district", role_key: "superintendent",
    full_name: "Rodney Green", title: "Superintendent", email: "rgreen@blountboe.net",
    phone: "205-775-1950", source_url: "https://www.blountboe.net/about-us/superintendent",
    evidence_note: "Official Blount County Schools superintendent page and directory."
  },
  {
    state_code: "AL", county: "Blount", scope: "district", role_key: "assistant_superintendent",
    full_name: "Christopher Lakey", title: "Assistant Superintendent", email: "clakey@blountboe.net",
    phone: "205-775-1950", source_url: "https://www.blountboe.net/link-3",
    evidence_note: "Official Blount County Schools directory."
  },
  {
    state_code: "AL", county: "Blount", scope: "district", role_key: "it_director",
    full_name: "Brad Williams", title: "Technology Director", email: "bdwilliams@blountboe.net",
    phone: "205-775-1950", source_url: "https://www.blountboe.net/departments/technology",
    evidence_note: "Official Blount County Schools technology staff page."
  },
  {
    state_code: "AL", county: "Blount", scope: "district", role_key: "school_board",
    full_name: "Chris Latta", title: "Board Member, President, District V", email: null,
    phone: "205-775-1950", source_url: "https://www.blountboe.net/about-us/school-board",
    evidence_note: "Official Blount County Schools board page."
  }
] as const;

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  for (const r of rows) {
    const agencyRows = r.county ? await sql.query(
      `select id from agencies where agency_type='k12' and state_code='AL' and county=$1 order by (canonical_name ilike '%county%') desc, canonical_name limit 1`,
      [r.county]
    ) as any[] : [];
    const agencyId = agencyRows[0]?.id ?? null;

    await sql.query(`
      update raven_state_contacts
      set verification_status='rejected', evidence_note='Excluded by strict outreach policy: facilities/plant/maintenance/buildings & grounds/generic operations are not approved school-security outreach roles', updated_at=now()
      where state_code='AL' and verification_status='candidate'
        and coalesce(title,'') ~* '(facilit|plant|maintenance|buildings?\\s*(and|&)\\s*grounds|grounds|custod|(^|\\W)operations(\\W|$))'
    `);

    const existing = await sql.query(`
      select id from raven_state_contacts
      where state_code=$1 and coalesce(county,'')=coalesce($2,'') and scope=$3 and role_key=$4
        and (agency_id is not distinct from $5 or $5 is null)
      order by case when verification_status='missing' then 0 else 1 end, id limit 1
    `,[r.state_code,r.county,r.scope,r.role_key,agencyId]) as any[];

    if (existing[0]?.id) {
      await sql.query(`update raven_state_contacts set agency_id=coalesce($2,agency_id), full_name=$3,title=$4,email=$5,phone=$6,source_url=$7,verification_status='verified',verified_at=now(),evidence_note=$8,updated_at=now() where id=$1`,
        [existing[0].id,agencyId,r.full_name,r.title,r.email,r.phone,r.source_url,r.evidence_note]);
    } else {
      await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verified',now(),$11)`,
        [r.state_code,r.county,agencyId,r.scope,r.role_key,r.full_name,r.title,r.email,r.phone,r.source_url,r.evidence_note]);
    }
  }

  const summary = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='AL'`) as any[];
  console.log('RAVEN_ALABAMA_BUILD', JSON.stringify(summary[0]));
  return NextResponse.json({ok:true,state:'AL',...summary[0]});
}
