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

  // Older builds created a second row for a candidate/verified person beside the required
  // role slot. Collapse each state/county/agency/role to exactly one review row first.
  await sql.query(`drop index if exists raven_state_contacts_unique_slot`);
  await sql.query(`
    with ranked as (
      select id,
        row_number() over (
          partition by state_code,coalesce(county,''),coalesce(agency_id,'00000000-0000-0000-0000-000000000000'::uuid),scope,role_key
          order by case verification_status when 'verified' then 1 when 'candidate' then 2 when 'missing' then 3 else 4 end,
                   (email is not null) desc,(phone is not null) desc,(source_url is not null) desc,updated_at desc,id desc
        ) rn
      from raven_state_contacts
    )
    delete from raven_state_contacts c using ranked r where c.id=r.id and r.rn>1
  `);
  await sql.query(`create unique index if not exists raven_state_contacts_unique_slot on raven_state_contacts(state_code,coalesce(county,''),coalesce(agency_id,'00000000-0000-0000-0000-000000000000'::uuid),scope,role_key)`);
  await sql.query(`create index if not exists raven_state_contacts_state_idx on raven_state_contacts(state_code,county,role_key,verification_status)`);

  await sql.query(`
    insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status)
    select a.state_code,a.county,a.id,'district',r.role_key,'missing'
    from agencies a
    cross join (values ('security_director'),('school_board'),('superintendent'),('assistant_superintendent'),('it_director')) r(role_key)
    where a.agency_type='k12'
      and a.state_code is not null
      and a.county is not null and btrim(a.county)<>''
      and (a.jurisdiction_level='county' or a.canonical_name ilike '%county%')
    on conflict do nothing
  `);

  await sql.query(`
    insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status)
    select s.state_code,null,null,'state','state_security_director','missing'
    from (select distinct state_code from agencies where agency_type='k12' and state_code is not null) s
    on conflict do nothing
  `);

  // Strict title matching only. Facilities, plant, maintenance, buildings/grounds,
  // procurement, finance and generic operations are never candidates for this review list.
  const candidates = await sql.query(`
    with mapped as (
      select distinct on (a.id, role_key)
        a.id agency_id,a.state_code,a.county,
        case
          when lower(rp.title) ~ '(assistant|asst\\.?)[[:space:]-]+superintendent' then 'assistant_superintendent'
          when lower(rp.title) ~ '(^|[[:space:]])superintendent([[:space:]]|$)' and lower(rp.title) !~ '(assistant|asst\\.?|deputy|associate)' then 'superintendent'
          when lower(rp.title) ~ '(director|chief).*(security|school safety|public safety)|(security|school safety|public safety).*(director|chief)' then 'security_director'
          when lower(rp.title) ~ 'director.*(information technology|technology|information systems|it services)|(information technology|technology|information systems).*(director)' then 'it_director'
          when lower(rp.title) ~ '(school )?board (member|chair|chairman|chairwoman|president|vice president|trustee)|board trustee' then 'school_board'
        end role_key,
        rp.full_name,rp.title,rp.email,rp.phone,rp.source_url,rp.confidence
      from raven_people rp
      join agencies a on a.id=rp.agency_id
      where a.agency_type='k12' and a.state_code is not null
        and a.county is not null and btrim(a.county)<>''
        and (a.jurisdiction_level='county' or a.canonical_name ilike '%county%')
        and rp.full_name is not null and btrim(rp.full_name)<>''
        and rp.title is not null and btrim(rp.title)<>''
        and rp.source_url is not null and btrim(rp.source_url)<>''
        and lower(rp.title) !~ '(facilit|plant|maintenance|operations|buildings|grounds|procurement|purchasing|finance|financial|principal|teacher)'
        and (
          lower(rp.title) ~ '(assistant|asst\\.?)[[:space:]-]+superintendent'
          or (lower(rp.title) ~ '(^|[[:space:]])superintendent([[:space:]]|$)' and lower(rp.title) !~ '(assistant|asst\\.?|deputy|associate)')
          or lower(rp.title) ~ '(director|chief).*(security|school safety|public safety)|(security|school safety|public safety).*(director|chief)'
          or lower(rp.title) ~ 'director.*(information technology|technology|information systems|it services)|(information technology|technology|information systems).*(director)'
          or lower(rp.title) ~ '(school )?board (member|chair|chairman|chairwoman|president|vice president|trustee)|board trustee'
        )
      order by a.id,role_key,rp.confidence desc nulls last,rp.last_verified_at desc nulls last
    ) select * from mapped where role_key is not null
  `) as any[];

  for (const r of candidates) {
    await sql.query(`
      update raven_state_contacts
      set full_name=$4,title=$5,email=$6,phone=$7,source_url=$8,verification_status='candidate',
          evidence_note='Imported from existing Raven record; requires current official-source verification before sending.',updated_at=now()
      where state_code=$1 and agency_id=$2 and role_key=$3 and verification_status='missing'
    `,[r.state_code,r.agency_id,r.role_key,r.full_name,r.title,r.email,r.phone,r.source_url]);
  }

  // Current official-source verifications already completed for Blount County Schools.
  const verified = [
    ['Blount County','superintendent','Rodney Green','Superintendent, Blount County Schools','rgreen@blountboe.net','205-775-1950','https://www.blountboe.net/about-us/superintendent'],
    ['Blount County','assistant_superintendent','Christopher Lakey','Assistant Superintendent','clakey@blountboe.net','205-775-1950','https://www.blountboe.net/link-3'],
    ['Blount County','it_director','Brad Williams','Technology Director','bdwilliams@blountboe.net','205-775-1950','https://www.blountboe.net/departments/technology'],
    ['Blount County','security_director','Meagan Holt','Federal Programs Coordinator, EL/Migrant Coordinator, Safety Coordinator','mholt@blountboe.net','205-775-1950','https://www.blountboe.net/link-3'],
    ['Blount County','school_board','Chris Latta','Board Member, President, District V',null,'205-775-1950','https://www.blountboe.net/about-us/school-board']
  ] as const;

  for (const [county, role, fullName, title, email, phone, source] of verified) {
    await sql.query(`
      update raven_state_contacts c
      set full_name=$4,title=$5,email=$6,phone=$7,source_url=$8,verification_status='verified',verified_at=now(),
          evidence_note='Verified against current official district source.',updated_at=now()
      from agencies a
      where c.agency_id=a.id and c.state_code='AL' and c.county=$1 and c.role_key=$2
        and (a.jurisdiction_level='county' or a.canonical_name ilike '%county%')
    `,[county,role,fullName,title,email,phone,source]);
  }

  const rows = await sql.query(`
    select state_code,count(*)::int slots,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidates,
      count(*) filter(where verification_status='missing')::int missing,
      count(*) filter(where verification_status='rejected')::int rejected
    from raven_state_contacts group by state_code order by state_code
  `) as any[];

  const alMissing = await sql.query(`
    select c.county,a.canonical_name,c.role_key,c.verification_status
    from raven_state_contacts c left join agencies a on a.id=c.agency_id
    where c.state_code='AL' and c.verification_status<>'verified'
    order by c.county nulls first,a.canonical_name,c.role_key
    limit 80
  `) as any[];

  console.log('RAVEN_CONTACT_SCHEMA_READY', JSON.stringify(rows));
  console.log('RAVEN_AL_REVIEW_QUEUE', JSON.stringify(alMissing));
  return NextResponse.json({ok:true,states:rows,alQueue:alMissing});
}
