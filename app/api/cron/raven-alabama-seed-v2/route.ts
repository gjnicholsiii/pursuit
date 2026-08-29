import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireInternalAuth } from '@/lib/internal-auth';
import { ALABAMA_STATE_SEEDS } from '@/lib/raven-state-seeds/alabama';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  // Remove records that can never qualify under the user's outreach rules.
  // The state School Safety administrator is the sole intentional exception because
  // the current ALSDE title explicitly includes School Safety ownership.
  await sql.query(`
    update raven_state_contacts
    set verification_status='rejected',verified_at=null,
      evidence_note=coalesce(evidence_note,'') || ' Rejected by strict outreach-role audit: facilities/plant/maintenance/buildings/grounds/generic operations are excluded.',
      updated_at=now()
    where state_code='AL' and scope<>'state'
      and verification_status in ('verified','candidate')
      and lower(coalesce(title,'')) ~ '(facilit|plant|maintenance|buildings|grounds|(^|[^a-z])operations([^a-z]|$))'
  `);

  // Known stale role: BCBE's current official page now identifies Marty McRae as
  // Superintendent. A legacy Safety/Prevention page still shows his prior job.
  await sql.query(`
    update raven_state_contacts
    set verification_status='rejected',verified_at=null,
      evidence_note='Rejected as stale: current official BCBE superintendent page identifies Marty McRae as Superintendent; prior safety-role page has not been updated.',updated_at=now()
    where state_code='AL' and county='Baldwin' and role_key='security_director' and lower(full_name)=lower('Marty McRae')
  `);

  // Coordinator of Technology is not the requested IT Director role. Preserve the
  // source as a rejected discovery rather than promoting an adjacent title.
  await sql.query(`
    update raven_state_contacts
    set verification_status='rejected',verified_at=null,
      evidence_note='Rejected for outreach role: Coordinator of Technology is not the requested IT Director title.',updated_at=now()
    where state_code='AL' and county='Autauga' and role_key='it_director' and lower(full_name)=lower('William Conyers')
  `);

  for (const r of ALABAMA_STATE_SEEDS) {
    const agencies = r.scope === 'state' ? [] : await sql.query(
      `select id from agencies where state_code=$1 and agency_type='k12' and lower(coalesce(county,''))=lower($2) order by (canonical_name ilike $2||'%') desc,id limit 1`,
      [r.state_code, r.county]
    ) as any[];
    const agencyId = r.scope === 'state' ? null : agencies[0]?.id || null;

    const existing = await sql.query(
      `select id from raven_state_contacts where state_code=$1 and coalesce(county,'')=coalesce($2,'') and scope=$3 and role_key=$4 and lower(coalesce(full_name,''))=lower($5) limit 1`,
      [r.state_code, r.county, r.scope, r.role_key, r.full_name]
    ) as any[];

    if (existing.length) {
      await sql.query(
        `update raven_state_contacts set agency_id=coalesce($2,agency_id),title=$3,email=$4,phone=$5,source_url=$6,verification_status='verified',verified_at=now(),evidence_note=$7,updated_at=now() where id=$1`,
        [existing[0].id, agencyId, r.title, r.email, r.phone, r.source_url, r.evidence_note]
      );
    } else {
      await sql.query(
        `insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verified',now(),$11,now())`,
        [r.state_code,r.county,agencyId,r.scope,r.role_key,r.full_name,r.title,r.email,r.phone,r.source_url,r.evidence_note]
      );
    }
  }

  await sql.query(`delete from raven_state_contacts m where state_code='AL' and verification_status='missing' and full_name is null and exists(select 1 from raven_state_contacts v where v.state_code=m.state_code and coalesce(v.county,'')=coalesce(m.county,'') and v.scope=m.scope and v.role_key=m.role_key and v.verification_status='verified' and v.full_name is not null)`);

  const counts = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='AL'`) as any[];
  const byCounty = await sql.query(`
    select coalesce(county,'STATE') county,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidate,
      count(*) filter(where verification_status='missing')::int missing,
      count(*) filter(where verification_status='rejected')::int rejected
    from raven_state_contacts where state_code='AL'
    group by county order by county nulls first
  `) as any[];
  console.log('RAVEN_ALABAMA_V2_PROGRESS', JSON.stringify(counts[0]));
  console.log('RAVEN_ALABAMA_COUNTY_AUDIT', JSON.stringify(byCounty));
  return NextResponse.json({ok:true,state:'AL',counts:counts[0],counties:byCounty});
}
