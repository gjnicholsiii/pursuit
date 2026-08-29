import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const rows = [
  {state_code:'AL',county:null,scope:'state',role_key:'state_security_director',full_name:'Dr. Johnny H. Whaley',title:'School Facilities and Safety Administrator',email:'johnny.whaley@alsde.edu',phone:'334-694-4900',source_url:'https://www.alabamaachieves.org/wp-content/uploads/2025/12/SBOE_20251218_School-Security-Act-Presentation_v1.pdf',evidence_note:'ALSDE School Security Act presentation, Dec. 2025; role also referenced in Apr. 9, 2026 SIR certification memo.'},
  {state_code:'AL',county:'Autauga',scope:'district',role_key:'superintendent',full_name:'Lyman Woodfin',title:'Superintendent',email:null,phone:'334-387-1910',source_url:'https://www.acboe.net/superintendentwoodfin',evidence_note:'Current Autauga County Schools superintendent page; phone corroborated by ALSDE Directory of Alabama Public Schools 2025.'},
  {state_code:'AL',county:'Autauga',scope:'district',role_key:'it_director',full_name:'William Conyers',title:'Coordinator of Technology',email:null,phone:null,source_url:'https://www.acboe.net/newemployees',evidence_note:'Official Autauga County Schools post identifies William Conyers as Coordinator of Technology; no direct email/phone published in source.'},
  {state_code:'AL',county:'Autauga',scope:'district',role_key:'school_board',full_name:'Bradley D. Robbins',title:'District 1 Board Member',email:null,phone:null,source_url:'https://www.acboe.net/sys/content/newspost/2d57620e4ac14768b8e48be691d8db7a',evidence_note:'Official district announcement of appointment and swearing-in as District 1 board member.'},
  {state_code:'AL',county:'Baldwin',scope:'district',role_key:'superintendent',full_name:'Marty McRae',title:'Superintendent',email:'mmcrae@bcbe.org',phone:'251-937-0308',source_url:'https://www.bcbe.org/superintendent-senior-staff/superintendent',evidence_note:'Current Baldwin County Public Schools superintendent page. Email also published in BCBE handbook.'},
  {state_code:'AL',county:'Baldwin',scope:'district',role_key:'it_director',full_name:'David Besancon, Ph.D., M.B.A.',title:'Assistant Superintendent Education Technology',email:'dbesancon@bcbe.org',phone:'251-937-0306',source_url:'https://www.bcbe.org/bcbe-staff-directory?const_page=3',evidence_note:'Current BCBE staff directory and Educational Technology page.'},
  {state_code:'AL',county:'Baldwin',scope:'district',role_key:'school_board',full_name:'Ken Bradley',title:'District 1 Board Member',email:null,phone:'251-406-8258',source_url:'https://www.bcbe.org/board-of-education/bcbe-board-members',evidence_note:'Current BCBE board member page.'},
  {state_code:'AL',county:'Baldwin',scope:'district',role_key:'school_board',full_name:'Andrea Lindsey',title:'District 2 Board Member',email:null,phone:'251-586-4274',source_url:'https://www.bcbe.org/board-of-education/bcbe-board-members',evidence_note:'Current BCBE board member page.'},
  {state_code:'AL',county:'Baldwin',scope:'district',role_key:'school_board',full_name:'Tony Myrick',title:'District 3 Board President',email:null,phone:null,source_url:'https://www.bcbe.org/board-of-education/bcbe-board-members',evidence_note:'Current BCBE board member page.'},
  {state_code:'AL',county:'Baldwin',scope:'district',role_key:'school_board',full_name:'Rondi Kirby',title:'District 4 Board Member',email:null,phone:null,source_url:'https://www.bcbe.org/board-of-education/bcbe-board-members',evidence_note:'Current BCBE board member page.'},
  {state_code:'AL',county:'Baldwin',scope:'district',role_key:'school_board',full_name:'Jason P. Woerner',title:'District 5 Board Member',email:null,phone:'251-232-0038',source_url:'https://www.bcbe.org/board-of-education/bcbe-board-members',evidence_note:'Current BCBE board member page.'},
  {state_code:'AL',county:'Baldwin',scope:'district',role_key:'school_board',full_name:'April Bradley',title:'District 7 Board Vice President',email:null,phone:null,source_url:'https://www.bcbe.org/board-of-education/bcbe-board-members',evidence_note:'Current BCBE board member page.'},
  {state_code:'AL',county:'Barbour',scope:'district',role_key:'superintendent',full_name:'Dr. Jimmie C. Fryer',title:'Superintendent',email:null,phone:'334-775-3453',source_url:'https://www.barbourcountyschools.org/article/2886265',evidence_note:'Official district May 11, 2026 article identifies Jimmie Fryer as superintendent; district phone used because direct line not published.'},
  {state_code:'AL',county:'Barbour',scope:'district',role_key:'it_director',full_name:'Timothy Rumph',title:'Director of Technology',email:'timothy.rumph@barbourschools.org',phone:'334-621-0055',source_url:'https://www.barbourcountyschools.org/staff',evidence_note:'Current official Barbour County School District staff directory.'},
  {state_code:'AL',county:'Barbour',scope:'district',role_key:'it_director',full_name:'Geoff Jones',title:'Executive Director of Technology',email:null,phone:'334-775-3453',source_url:'https://www.barbourcountyschools.org/page/technology',evidence_note:'Current official Barbour County technology department page.'},
  {state_code:'AL',county:'Barbour',scope:'district',role_key:'school_board',full_name:'Jean Kennedy',title:'Board President',email:null,phone:null,source_url:'https://www.barbourcountyschools.org/news/',evidence_note:'Official district news identifies Jean Kennedy as School Board President in Feb. 2025; retain as candidate until a 2026 board roster confirms current status.',verification_status:'candidate'}
];

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req); if (auth) return auth;
  const sql = getSql();
  for (const r of rows) {
    const agencyRows = r.scope==='state' ? [] : await sql.query(`select id from agencies where state_code=$1 and agency_type='k12' and lower(coalesce(county,''))=lower($2) order by (canonical_name ilike $2||'%') desc,id limit 1`,[r.state_code,r.county]);
    const agencyId = r.scope==='state' ? null : (agencyRows as any[])[0]?.id || null;
    await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,case when $11='verified' then now() else null end,$12,now()) on conflict do nothing`,[r.state_code,r.county,agencyId,r.scope,r.role_key,r.full_name,r.title,r.email,r.phone,r.source_url,r.verification_status||'verified',r.evidence_note]);
  }
  await sql.query(`delete from raven_state_contacts m where state_code='AL' and verification_status='missing' and full_name is null and exists(select 1 from raven_state_contacts v where v.state_code=m.state_code and coalesce(v.county,'')=coalesce(m.county,'') and v.scope=m.scope and v.role_key=m.role_key and v.verification_status in('verified','candidate') and v.full_name is not null)`);
  const counts = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='AL'`);
  console.log('RAVEN_ALABAMA_PROGRESS', JSON.stringify((counts as any[])[0]));
  return NextResponse.json({ok:true,state:'AL',counts:(counts as any[])[0]});
}
