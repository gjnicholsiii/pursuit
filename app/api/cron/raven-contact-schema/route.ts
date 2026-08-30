import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const verifiedSeeds = [
  {state:"AL",county:null,scope:"state",role:"state_security_director",name:"Dr. Johnny H. Whaley",title:"School Facilities and Safety Administrator",email:"johnny.whaley@alsde.edu",phone:"334-694-4717",source:"https://www.alabamaachieves.org/wp-content/uploads/2025/12/SBOE_20251218_School-Security-Act-Presentation_v1.pdf",note:"ALSDE School Safety Team; title shown in Dec. 18, 2025 School Security Act presentation; email and School Safety contact phone confirmed in ALSDE safety memoranda."},
  {state:"AL",county:"Autauga",scope:"district",role:"superintendent",name:"Lyman Woodfin",title:"Superintendent",email:null,phone:"334-365-5706",source:"https://www.acboe.net/superintendentupdate022026",note:"Current Autauga County Schools superintendent confirmed by official district February 2026 update."},
  {state:"AL",county:"Baldwin",scope:"district",role:"superintendent",name:"Marty McRae",title:"Superintendent",email:null,phone:"251-937-0308",source:"https://www.bcbe.org/superintendent-senior-staff/superintendent",note:"Current superintendent and office phone confirmed by official BCBE page."},
  {state:"AL",county:"Baldwin",scope:"district",role:"security_director",name:"Jeff Spaller",title:"Safety Supervisor",email:null,phone:"251-972-6854",source:"https://www.bcbe.org/departments/athletics-prevention-safety/safety",note:"Official BCBE Safety Department contact; true district safety role."},
  {state:"AL",county:"Baldwin",scope:"district",role:"assistant_superintendent",name:"Joe Sharp",title:"Assistant Superintendent, Secondary Education",email:null,phone:"251-937-0306",source:"https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-secondary-education",note:"Official BCBE assistant superintendent page; district main phone used because direct number is not published on source page."},
  {state:"AL",county:"Baldwin",scope:"district",role:"assistant_superintendent",name:"Dr. Shannon McCurdy",title:"Assistant Superintendent, Elementary Education",email:null,phone:"251-937-0306",source:"https://www.bcbe.org/departments/academics/elementary-education",note:"Official BCBE assistant superintendent page; district main phone used because direct number is not published on source page."},
  {state:"AL",county:"Baldwin",scope:"district",role:"it_director",name:"Dr. David Besancon",title:"Assistant Superintendent, Educational Technology",email:null,phone:"251-937-0306",source:"https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-educational-technology",note:"Official BCBE executive responsible for Educational Technology; exact title preserved."},
  {state:"AL",county:"Baldwin",scope:"district",role:"school_board",name:"Ken Bradley",title:"Board Member, District 1",email:null,phone:"251-406-8258",source:"https://www.bcbe.org/board-of-education/bcbe-board-members",note:"Official BCBE board member page."},
  {state:"AL",county:"Baldwin",scope:"district",role:"school_board",name:"Andrea Lindsey",title:"Board Member, District 2",email:null,phone:"251-586-4274",source:"https://www.bcbe.org/board-of-education/bcbe-board-members",note:"Official BCBE board member page."},
  {state:"AL",county:"Baldwin",scope:"district",role:"school_board",name:"Tony Myrick",title:"Board President, District 3",email:null,phone:null,source:"https://www.bcbe.org/board-of-education/bcbe-board-members",note:"Official BCBE board member page."},
  {state:"AL",county:"Baldwin",scope:"district",role:"school_board",name:"Rondi Kirby",title:"Board Member, District 4",email:null,phone:null,source:"https://www.bcbe.org/board-of-education/bcbe-board-members",note:"Official BCBE board member page."},
  {state:"AL",county:"Baldwin",scope:"district",role:"school_board",name:"Cecil Christenberry",title:"Board Member, District 6",email:null,phone:null,source:"https://www.bcbe.org/board-of-education/bcbe-board-members",note:"Official BCBE board member page."},
  {state:"AL",county:"Baldwin",scope:"district",role:"school_board",name:"April Bradley",title:"Board Vice President, District 7",email:null,phone:null,source:"https://www.bcbe.org/board-of-education/bcbe-board-members",note:"Official BCBE board member page."}
];

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req); if (auth) return auth;
  const sql = getSql();
  await sql.query(`create table if not exists raven_state_contacts (id bigserial primary key,state_code text not null,county text,agency_id bigint references agencies(id) on delete set null,scope text not null,role_key text not null,full_name text,title text,email text,phone text,source_url text,verification_status text not null default 'missing',verified_at timestamptz,evidence_note text,created_at timestamptz not null default now(),updated_at timestamptz not null default now())`);
  await sql.query(`create unique index if not exists raven_state_contacts_identity on raven_state_contacts(state_code,coalesce(county,''),scope,role_key,coalesce(lower(full_name),''))`);
  await sql.query(`insert into raven_state_contacts(state_code,county,scope,role_key,verification_status) select 'AL',county,'district',role,'missing' from (select distinct county from agencies where agency_type='k12' and state_code='AL' and county is not null and btrim(county)<>'') c cross join (values ('security_director'),('school_board'),('superintendent'),('assistant_superintendent'),('it_director')) r(role) on conflict do nothing`);
  await sql.query(`insert into raven_state_contacts(state_code,county,scope,role_key,verification_status) values ('AL',null,'state','state_security_director','missing') on conflict do nothing`);
  for (const s of verifiedSeeds) {
    await sql.query(`insert into raven_state_contacts(state_code,county,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified',now(),$10) on conflict (state_code,(coalesce(county,'')),scope,role_key,(coalesce(lower(full_name),''))) do update set title=excluded.title,email=excluded.email,phone=excluded.phone,source_url=excluded.source_url,verification_status='verified',verified_at=now(),evidence_note=excluded.evidence_note,updated_at=now()`, [s.state,s.county,s.scope,s.role,s.name,s.title,s.email,s.phone,s.source,s.note]);
  }
  const totals = await sql.query(`select state_code,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*)::int total from raven_state_contacts where state_code='AL' group by state_code`) as any[];
  console.log('RAVEN_STATE_CONTACT_PROGRESS', JSON.stringify(totals[0]||{}));
  return NextResponse.json({ok:true,state:'AL',progress:totals[0]||{}});
}
