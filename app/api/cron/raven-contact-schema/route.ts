import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const AL_COUNTIES = [
  'Autauga','Baldwin','Barbour','Bibb','Blount','Bullock','Butler','Calhoun','Chambers','Cherokee','Chilton','Choctaw','Clarke','Clay','Cleburne','Coffee','Colbert','Conecuh','Coosa','Covington','Crenshaw','Cullman','Dale','Dallas','DeKalb','Elmore','Escambia','Etowah','Fayette','Franklin','Geneva','Greene','Hale','Henry','Houston','Jackson','Jefferson','Lamar','Lauderdale','Lawrence','Lee','Limestone','Lowndes','Macon','Madison','Marengo','Marion','Marshall','Mobile','Monroe','Montgomery','Morgan','Perry','Pickens','Pike','Randolph','Russell','Shelby','St. Clair','Sumter','Talladega','Tallapoosa','Tuscaloosa','Walker','Washington','Wilcox','Winston'
] as const;

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
  await sql.query(`create index if not exists raven_state_contacts_state_idx on raven_state_contacts(state_code,county,role_key,verification_status)`);

  /* One-time Alabama normalization: one county school system per county, five required review roles. */
  const existingAl = await sql.query(`select count(*)::int n from raven_state_contacts where state_code='AL'`) as any[];
  if (Number(existingAl[0]?.n || 0) !== 336) {
    await sql.query(`delete from raven_state_contacts where state_code='AL'`);
    for (const county of AL_COUNTIES) {
      const agencies = await sql.query(`
        select id::text,canonical_name,website
        from agencies
        where state_code='AL' and agency_type='k12'
          and (trim(county)= $1 or trim(county)= $1 || ' County' or canonical_name ilike $1 || '%County%' or canonical_name ilike $1 || '%Schools%')
        order by
          case when lower(canonical_name)=lower($1 || ' County') then 0
               when lower(canonical_name)=lower($1 || ' County Schools') then 1
               when lower(canonical_name)=lower($1 || ' County School District') then 2
               else 3 end,
          (website is not null and website<>'') desc,
          canonical_name
        limit 1
      `,[county]) as any[];
      const agencyId = agencies[0]?.id || null;
      for (const role of ['security_director','school_board','superintendent','assistant_superintendent','it_director']) {
        await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status,evidence_note) values('AL',$1,$2,'county',$3,'missing','Required Alabama county review slot; no contact invented when official source is absent.')`,[county,agencyId,role]);
      }
    }
    await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status,evidence_note) values('AL',null,null,'state','state_security_director','missing','Required Alabama state school-safety/security contact.')`);
  }

  /* Keep other states seeded from Raven, but only as review slots/candidates. */
  await sql.query(`
    insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status)
    select a.state_code,a.county,a.id,'district',r.role_key,'missing'
    from agencies a
    cross join (values ('security_director'),('school_board'),('superintendent'),('assistant_superintendent'),('it_director')) r(role_key)
    where a.agency_type='k12' and a.state_code is not null and a.state_code<>'AL'
      and a.county is not null and btrim(a.county)<>''
      and (a.jurisdiction_level='county' or a.canonical_name ilike '%county%')
      and not exists(select 1 from raven_state_contacts c where c.state_code=a.state_code and c.agency_id=a.id and c.role_key=r.role_key)
  `);
  await sql.query(`
    insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status)
    select s.state_code,null,null,'state','state_security_director','missing'
    from (select distinct state_code from agencies where agency_type='k12' and state_code is not null and state_code<>'AL') s
    where not exists(select 1 from raven_state_contacts c where c.state_code=s.state_code and c.scope='state' and c.role_key='state_security_director')
  `);

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
      from raven_people rp join agencies a on a.id=rp.agency_id
      where a.agency_type='k12' and a.state_code is not null
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

  const verified = [
    ['Blount','superintendent','Rodney Green','Superintendent, Blount County Schools','rgreen@blountboe.net','205-775-1950','https://www.blountboe.net/about-us/superintendent'],
    ['Blount','assistant_superintendent','Christopher Lakey','Assistant Superintendent','clakey@blountboe.net','205-775-1950','https://www.blountboe.net/link-3'],
    ['Blount','it_director','Brad Williams','Technology Director','bdwilliams@blountboe.net','205-775-1950','https://www.blountboe.net/departments/technology'],
    ['Blount','security_director','Meagan Holt','Federal Programs Coordinator, EL/Migrant Coordinator, Safety Coordinator','mholt@blountboe.net','205-775-1950','https://www.blountboe.net/link-3'],
    ['Blount','school_board','Chris Latta','Board Member, President, District V',null,'205-775-1950','https://www.blountboe.net/about-us/school-board'],
    ['Bullock','superintendent','Sean C. Dees','Superintendent of Education',null,'334-513-1416','https://www.bullockco.org/about-us/superintendent'],
    ['Bullock','school_board','LaDerrick Caldwell','Board President',null,'334-513-1416','https://www.bullockco.org/about-us/board-of-education/board-members'],
    ['Butler','superintendent','Joseph Eiland','Superintendent','joe.eiland@butlerco.k12.al.us','334-382-2665','https://www.butlerco.k12.al.us/our-district/superintendents-message'],
    ['Butler','assistant_superintendent','Lisa Adair','Assistant Superintendent',null,'334-382-2665 ext 1219','https://www.butlerco.k12.al.us/'],
    ['Butler','it_director','Matthew Shell','Technology Director',null,'334-382-2665 ext 1411','https://www.butlerco.k12.al.us/departments/technology'],
    ['Butler','school_board','Michael Nimmer','Board Member - District 1',null,'334-382-2104','https://www.butlerco.k12.al.us/our-district/board-of-education'],
    ['Calhoun','superintendent','Tony Willis','Superintendent','twillis@ccboe.us','256-741-7400','https://www.calhouncountyschools.com/our-district/board-of-education'],
    ['Calhoun','school_board','Michael Webb','Board President','ccboewebb@gmail.com','256-741-7400','https://www.calhouncountyschools.com/our-district/board-of-education'],
    ['Calhoun','it_director','Lance Driskell','Technology Director','ldriskell@ccboe.us','256-741-7483','https://www.calhouncountyschools.com/departments/technology/staff']
  ] as const;
  for (const [county, role, fullName, title, email, phone, source] of verified) {
    await sql.query(`update raven_state_contacts set full_name=$3,title=$4,email=$5,phone=$6,source_url=$7,verification_status='verified',verified_at=now(),evidence_note='Verified against current official district source.',updated_at=now() where state_code='AL' and county=$1 and role_key=$2`,[county,role,fullName,title,email,phone,source]);
  }

  const rows = await sql.query(`select state_code,count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidates,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts group by state_code order by state_code`) as any[];
  const alSummary = await sql.query(`select count(distinct county)::int counties,count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidates,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='AL'`) as any[];
  console.log('RAVEN_CONTACT_SCHEMA_READY', JSON.stringify(rows));
  console.log('RAVEN_AL_NORMALIZED', JSON.stringify(alSummary[0] || {}));
  return NextResponse.json({ok:true,states:rows,al:alSummary[0] || {}});
}
