import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const records = [
  {
    role_key: "superintendent",
    full_name: "Marty McRae",
    title: "Superintendent",
    email: null,
    phone: "251-937-0306",
    source_url: "https://www.bcbe.org/",
    evidence_note: "Current Baldwin County Public Schools homepage identifies Marty McRae as Superintendent and publishes the district central-office phone."
  },
  {
    role_key: "school_board",
    full_name: "Tony Myrick",
    title: "BCBE Board President",
    email: null,
    phone: "251-937-0306",
    source_url: "https://www.bcbe.org/board-of-education/bcbe-board-members",
    evidence_note: "Current official Baldwin County Public Schools Board of Education page identifies Tony Myrick as BCBE Board President; district central-office phone is published on the same official site."
  },
  {
    role_key: "assistant_superintendent",
    full_name: "Joe Sharp",
    title: "Assistant Superintendent, Secondary Education",
    email: null,
    phone: "251-937-0306",
    source_url: "https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-secondary-education",
    evidence_note: "Current official Baldwin County Public Schools senior-staff page identifies Joe Sharp as Assistant Superintendent, Secondary Education."
  },
  {
    role_key: "it_director",
    full_name: "David Besancon",
    title: "Assistant Superintendent, Educational Technology",
    email: null,
    phone: "251-937-0306",
    source_url: "https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-educational-technology",
    evidence_note: "Current official Baldwin County Public Schools senior-staff page identifies David Besancon as Assistant Superintendent, Educational Technology; the district handbook also identifies him as Ed Technology Director."
  },
  {
    role_key: "security_director",
    full_name: "Jeff Spaller",
    title: "Safety Supervisor",
    email: "jspaller@bcbe.org",
    phone: "251-972-6854",
    source_url: "https://www.bcbe.org/departments/athletics-prevention-safety/safety",
    evidence_note: "Current official Baldwin County Public Schools Safety page identifies Jeff Spaller as Safety Supervisor, publishes office and cell numbers, and links jspaller@bcbe.org as his email."
  }
] as const;

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  const agencies = await sql.query(`select id from agencies where agency_type='k12' and state_code='AL' and county='Baldwin' order by case when jurisdiction_level='county' or canonical_name ilike '%county%' then 0 else 1 end, canonical_name limit 1`) as any[];
  const agencyId = agencies[0]?.id || null;

  for (const r of records) {
    const slot = await sql.query(`select id from raven_state_contacts where state_code='AL' and county='Baldwin' and scope='district' and role_key=$1 order by case when verification_status='missing' and full_name is null then 0 when lower(coalesce(full_name,''))=lower($2) then 1 else 2 end, id limit 1`, [r.role_key,r.full_name]) as any[];
    if (slot[0]?.id) {
      await sql.query(`update raven_state_contacts set agency_id=coalesce($2,agency_id),full_name=$3,title=$4,email=$5,phone=$6,source_url=$7,verification_status='verified',verified_at=now(),evidence_note=$8,updated_at=now() where id=$1`, [slot[0].id,agencyId,r.full_name,r.title,r.email,r.phone,r.source_url,r.evidence_note]);
    } else {
      await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values('AL','Baldwin',$1,'district',$2,$3,$4,$5,$6,$7,'verified',now(),$8)`, [agencyId,r.role_key,r.full_name,r.title,r.email,r.phone,r.source_url,r.evidence_note]);
    }
  }

  await sql.query(`delete from raven_state_contacts m where m.state_code='AL' and m.county='Baldwin' and m.verification_status='missing' and m.full_name is null and exists(select 1 from raven_state_contacts v where v.state_code=m.state_code and v.county=m.county and v.role_key=m.role_key and v.verification_status='verified')`);

  const totals = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='AL'`) as any[];
  console.log('RAVEN_ALABAMA_BALDWIN_PROGRESS', JSON.stringify(totals[0] || {}));
  return NextResponse.json({ok:true,state:'AL',county:'Baldwin',...(totals[0] || {})});
}
