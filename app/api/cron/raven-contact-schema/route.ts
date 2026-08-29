import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  await sql.query(`
    create table if not exists raven_state_contacts (
      id bigserial primary key,
      state_code text not null,
      county text,
      agency_id bigint references agencies(id) on delete set null,
      scope text not null check (scope in ('state','county','district')),
      role_key text not null check (role_key in ('state_security_director','security_director','school_board','superintendent','assistant_superintendent','it_director')),
      full_name text,
      title text,
      email text,
      phone text,
      source_url text,
      verification_status text not null default 'missing' check (verification_status in ('missing','candidate','verified','rejected')),
      verified_at timestamptz,
      evidence_note text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);

  await sql.query(`create unique index if not exists raven_state_contacts_unique_slot on raven_state_contacts(state_code,coalesce(county,''),coalesce(agency_id,0),scope,role_key,coalesce(lower(full_name),''))`);
  await sql.query(`create index if not exists raven_state_contacts_state_idx on raven_state_contacts(state_code,county,role_key,verification_status)`);

  await sql.query(`
    insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status)
    select a.state_code,a.county,a.id,'district',r.role_key,'missing'
    from agencies a
    cross join (values ('security_director'),('school_board'),('superintendent'),('assistant_superintendent'),('it_director')) r(role_key)
    where a.agency_type='k12'
      and a.state_code is not null
      and a.county is not null
      and btrim(a.county)<>''
      and (a.jurisdiction_level='county' or a.canonical_name ilike '%county%')
    on conflict do nothing
  `);

  await sql.query(`
    insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status)
    select s.state_code,null,null,'state','state_security_director','missing'
    from (select distinct state_code from agencies where agency_type='k12' and state_code is not null) s
    on conflict do nothing
  `);

  const rows = await sql.query(`
    select state_code,
      count(*)::int slots,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='missing')::int missing
    from raven_state_contacts
    group by state_code
    order by state_code
  `) as any[];

  console.log('RAVEN_CONTACT_SCHEMA_READY', JSON.stringify(rows));
  return NextResponse.json({ok:true,states:rows});
}
