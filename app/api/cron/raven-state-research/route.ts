import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const AL = "AL";

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  // Only records independently confirmed from official public sources are promoted to verified.
  // Older or indirect evidence remains candidate and is never made send-eligible by this job.
  const autauga = await sql.query(`
    select id::bigint id
    from agencies
    where state_code='AL' and agency_type='k12'
      and (canonical_name ilike 'Autauga County%' or (county ilike 'Autauga%' and canonical_name ilike '%County%'))
    order by case when canonical_name ilike 'Autauga County%' then 0 else 1 end, canonical_name
    limit 1
  `) as any[];

  if (autauga[0]?.id) {
    await sql.query(`
      update raven_state_contacts
      set full_name='Lyman Woodfin', title='Superintendent', phone='334-365-5706',
          email=null,
          source_url='https://www.acboe.net/superintendent',
          verification_status='verified', verified_at=now(),
          evidence_note='Official Autauga County Schools superintendent page; current 2025-2026 updates identify Lyman Woodfin as Superintendent. District phone shown on official page.',
          updated_at=now()
      where state_code='AL' and agency_id=$1 and role_key='superintendent'
    `, [autauga[0].id]);
  }

  // ALSDE's 2024 school-safety memo names Dr. Erica Butler as a school-safety contact,
  // but the 2025 state directory places her under Compliance Monitoring rather than School Safety.
  // Preserve as candidate until a current ALSDE source confirms she still owns school safety.
  await sql.query(`
    update raven_state_contacts
    set full_name='Erica Butler, Ed.D.', title='Education Specialist - Crisis Management and School Safety',
        email='erica.butler@alsde.edu', phone='334-694-4717',
        source_url='https://www.alabamaachieves.org/wp-content/uploads/2024/06/StateSuperIn_Memos_20240611_FY24-3027_School-Safety-and-nSide-Training-2024_V1.0.pdf',
        verification_status='candidate', verified_at=null,
        evidence_note='Official ALSDE 2024 school-safety memo confirms role/contact; not promoted to verified because the 2025 ALSDE directory moved Butler to Compliance Monitoring.',
        updated_at=now()
    where state_code='AL' and scope='state' and role_key='state_security_director'
      and verification_status <> 'verified'
  `);

  const counts = await sql.query(`
    select count(*)::int slots,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidate,
      count(*) filter(where verification_status='missing')::int missing,
      count(*) filter(where verification_status='rejected')::int rejected
    from raven_state_contacts where state_code=$1
  `, [AL]) as any[];

  console.log('RAVEN_STATE_RESEARCH', JSON.stringify({state:AL,...counts[0]}));
  return NextResponse.json({ok:true,state:AL,...counts[0]});
}
