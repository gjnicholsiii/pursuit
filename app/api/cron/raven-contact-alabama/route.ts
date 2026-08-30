import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireInternalAuth } from '@/lib/internal-auth';
import { ALABAMA_VERIFIED_CONTACTS } from '@/lib/raven-alabama-verified';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();
  let inserted = 0;
  let unresolved = 0;

  for (const c of ALABAMA_VERIFIED_CONTACTS) {
    let agencyId: string | null = null;
    if (c.agency_match) {
      const agencies = await sql.query(
        `select id::text from agencies where agency_type='k12' and state_code=$1 and canonical_name ilike $2 order by case when canonical_name ilike '%County%' then 0 else 1 end, canonical_name limit 1`,
        [c.state_code, `%${c.agency_match}%`]
      ) as any[];
      agencyId = agencies[0]?.id || null;
      if (!agencyId) {
        unresolved++;
        continue;
      }
    }

    await sql.query(
      `delete from raven_state_contacts where state_code=$1 and coalesce(county,'')=coalesce($2,'') and coalesce(agency_id,0)=coalesce($3::bigint,0) and scope=$4 and role_key=$5 and full_name is null and verification_status='missing'`,
      [c.state_code, c.county, agencyId, c.scope, c.role_key]
    );

    const existing = await sql.query(
      `select id::text from raven_state_contacts where state_code=$1 and coalesce(county,'')=coalesce($2,'') and coalesce(agency_id,0)=coalesce($3::bigint,0) and scope=$4 and role_key=$5 and lower(coalesce(full_name,''))=lower($6) limit 1`,
      [c.state_code, c.county, agencyId, c.scope, c.role_key, c.full_name]
    ) as any[];

    if (existing[0]?.id) {
      await sql.query(
        `update raven_state_contacts set title=$2,email=$3,phone=$4,source_url=$5,verification_status='verified',verified_at=now(),evidence_note=$6,updated_at=now() where id=$1`,
        [existing[0].id, c.title, c.email, c.phone, c.source_url, c.evidence_note]
      );
    } else {
      await sql.query(
        `insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verified',now(),$11)`,
        [c.state_code, c.county, agencyId, c.scope, c.role_key, c.full_name, c.title, c.email, c.phone, c.source_url, c.evidence_note]
      );
    }
    inserted++;
  }

  const summary = await sql.query(`
    select state_code,
      count(*)::int slots,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidate,
      count(*) filter(where verification_status='missing')::int missing,
      count(distinct county) filter(where county is not null)::int counties
    from raven_state_contacts where state_code='AL' group by state_code
  `) as any[];

  console.log('RAVEN_ALABAMA_INGEST', JSON.stringify({ inserted, unresolved, summary: summary[0] || null }));
  return NextResponse.json({ ok: true, inserted, unresolved, summary: summary[0] || null });
}
