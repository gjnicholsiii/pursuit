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
      agency_id uuid references agencies(id) on delete set null,
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

  await sql.query(`create unique index if not exists raven_state_contacts_unique_slot on raven_state_contacts(state_code,coalesce(county,''),coalesce(agency_id,'00000000-0000-0000-0000-000000000000'::uuid),scope,role_key,coalesce(lower(full_name),''))`);
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

  await sql.query(`
    insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,evidence_note)
    select a.state_code,a.county,a.id,'district',
      case
        when lower(rp.title) ~ '(assistant|asst\\.?)[[:space:]-]+superintendent' then 'assistant_superintendent'
        when lower(rp.title) ~ '(^|[[:space:]])superintendent([[:space:]]|$)' and lower(rp.title) !~ '(assistant|asst\\.?|deputy|associate)' then 'superintendent'
        when lower(rp.title) ~ '(director|chief).*(security|school safety|public safety)|(security|school safety|public safety).*(director|chief)' then 'security_director'
        when lower(rp.title) ~ 'director.*(information technology|technology|information systems|it services)|(information technology|technology|information systems).*(director)' then 'it_director'
        when lower(rp.title) ~ '(school )?board (member|chair|chairman|chairwoman|president|vice president|trustee)|board trustee' then 'school_board'
      end,
      rp.full_name,rp.title,rp.email,rp.phone,rp.source_url,'candidate','Imported from existing Raven record; requires state-by-state official-source verification before sending.'
    from raven_people rp
    join agencies a on a.id=rp.agency_id
    where a.agency_type='k12'
      and a.state_code is not null
      and a.county is not null
      and btrim(a.county)<>''
      and (a.jurisdiction_level='county' or a.canonical_name ilike '%county%')
      and rp.full_name is not null and btrim(rp.full_name)<>''
      and rp.title is not null and btrim(rp.title)<>''
      and rp.source_url is not null and btrim(rp.source_url)<>''
      and (
        lower(rp.title) ~ '(assistant|asst\\.?)[[:space:]-]+superintendent'
        or (lower(rp.title) ~ '(^|[[:space:]])superintendent([[:space:]]|$)' and lower(rp.title) !~ '(assistant|asst\\.?|deputy|associate)')
        or lower(rp.title) ~ '(director|chief).*(security|school safety|public safety)|(security|school safety|public safety).*(director|chief)'
        or lower(rp.title) ~ 'director.*(information technology|technology|information systems|it services)|(information technology|technology|information systems).*(director)'
        or lower(rp.title) ~ '(school )?board (member|chair|chairman|chairwoman|president|vice president|trustee)|board trustee'
      )
      and lower(rp.title) !~ '(facilit|plant|maintenance|operations|buildings|grounds)'
    on conflict do nothing
  `);

  const verified = [
    ['superintendent','Rodney Green','Superintendent, Blount County Schools','rgreen@blountboe.net','205-775-1950','https://www.blountboe.net/about-us/superintendent'],
    ['assistant_superintendent','Christopher Lakey','Assistant Superintendent','clakey@blountboe.net','205-775-1950','https://www.blountboe.net/link-3'],
    ['it_director','Brad Williams','Technology Director','bdwilliams@blountboe.net','205-775-1950','https://www.blountboe.net/departments/technology'],
    ['security_director','Meagan Holt','Federal Programs Coordinator, EL/Migrant Coordinator, Safety Coordinator','mholt@blountboe.net','205-775-1950','https://www.blountboe.net/link-3'],
    ['school_board','Chris Latta','Board Member, President, District V',null,'205-775-1950','https://www.blountboe.net/about-us/school-board']
  ] as const;

  for (const [role, fullName, title, email, phone, source] of verified) {
    await sql.query(`
      update raven_state_contacts c
      set full_name=$3,title=$4,email=$5,phone=$6,source_url=$7,verification_status='verified',verified_at=now(),evidence_note='Verified against current official Blount County Schools source.',updated_at=now()
      from agencies a
      where c.agency_id=a.id and c.state_code=$1 and c.role_key=$2 and c.verification_status='missing'
        and a.canonical_name ilike 'Blount County%'
    `, ['AL', role, fullName, title, email, phone, source]);
  }

  const rows = await sql.query(`
    select state_code,
      count(*)::int slots,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidates,
      count(*) filter(where verification_status='missing')::int missing
    from raven_state_contacts
    group by state_code
    order by state_code
  `) as any[];

  console.log('RAVEN_CONTACT_SCHEMA_READY', JSON.stringify(rows));
  return NextResponse.json({ok:true,states:rows});
}
