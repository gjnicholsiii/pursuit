import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RecordRow = {
  state_code:string; county:string|null; scope:'state'|'district'; role_key:string; full_name:string; title:string;
  email:string|null; phone:string|null; source_url:string; evidence_note:string;
};

const records: RecordRow[] = [
  {state_code:'AL',county:'Blount',scope:'district',role_key:'superintendent',full_name:'Rodney Green',title:'Superintendent',email:'rgreen@blountboe.net',phone:'205-775-1950',source_url:'https://www.blountboe.net/link-3',evidence_note:'Official Blount County Schools directory lists Rodney Green as Superintendent with direct district email; district main phone shown on the same official site.'},
  {state_code:'AL',county:'Blount',scope:'district',role_key:'assistant_superintendent',full_name:'Christopher Lakey',title:'Assistant Superintendent',email:'clakey@blountboe.net',phone:'205-775-1950',source_url:'https://www.blountboe.net/link-3',evidence_note:'Official Blount County Schools directory lists Christopher Lakey as Assistant Superintendent with direct district email.'},
  {state_code:'AL',county:'Blount',scope:'district',role_key:'it_director',full_name:'Brad Williams',title:'Technology Director',email:'bdwilliams@blountboe.net',phone:'205-775-1950',source_url:'https://www.blountboe.net/departments/technology',evidence_note:'Official Blount County Schools Technology page lists Brad Williams as Technology Director with direct district email.'},
  {state_code:'AL',county:'Blount',scope:'district',role_key:'school_board',full_name:'Chris Latta',title:'Board Member, President, District V',email:null,phone:'205-775-1950',source_url:'https://www.blountboe.net/about-us/school-board',evidence_note:'Official Blount County Schools School Board page lists Chris Latta as Board Member and President. No individual email is published on the cited page; district phone retained without inventing an email.'},
  {state_code:'AK',county:null,scope:'state',role_key:'state_security_director',full_name:'Pat Sidmore',title:'Program Coordinator II — School Health and School Emergency Management',email:null,phone:'907-465-2939',source_url:'https://education.alaska.gov/safeschools/safeandemerg',evidence_note:'Alaska DEED official School Safety and Emergency Management page identifies Pat Sidmore as Program Coordinator II and the contact for school emergency management. No personal email is published on the cited page.'},
  {state_code:'AK',county:'Anchorage Municipality',scope:'district',role_key:'superintendent',full_name:'Dr. Jharrett Bryantt',title:'Superintendent',email:'officeofthesuperintendent@asdk12.org',phone:'907-742-4312',source_url:'https://www.asdk12.org/aboutasd/superintendent',evidence_note:'Official Anchorage School District superintendent page identifies Dr. Jharrett Bryantt as Superintendent and publishes the Office of the Superintendent email and phone.'},
  {state_code:'AK',county:'Anchorage Municipality',scope:'district',role_key:'it_director',full_name:'Mike Fleckenstein',title:'Chief Information Officer',email:null,phone:'907-742-1584',source_url:'https://www.asdk12.org/departments/information-technology',evidence_note:'Official Anchorage School District Information Technology page identifies Mike Fleckenstein as Chief Information Officer and publishes the IT main phone. No direct personal email is published on the cited page.'},
  {state_code:'AK',county:'Anchorage Municipality',scope:'district',role_key:'school_board',full_name:'Carl Jacobs',title:'School Board President',email:'jacobs_carl@asdk12.org',phone:'907-742-1101 ext. 5',source_url:'https://www.asdk12.org/school-board/board-members',evidence_note:'Official Anchorage School District Board Members page identifies Carl Jacobs as School Board President and publishes his individual district email and phone extension.'},
  {state_code:'AK',county:'Juneau City and Borough',scope:'district',role_key:'superintendent',full_name:'Shawn Arnold',title:'Superintendent of Schools',email:null,phone:'907-523-1700',source_url:'https://www.juneauschools.org/en-US',evidence_note:'Official Juneau School District home page identifies Shawn Arnold as Superintendent of Schools and publishes the district office phone. No direct personal email is published on the cited page.'},
  {state_code:'AK',county:'Juneau City and Borough',scope:'district',role_key:'school_board',full_name:'Juneau Board of Education',title:'Board of Education',email:'schoolboard@juneauschools.org',phone:'907-523-1700',source_url:'https://www.juneauschools.org/en-US',evidence_note:'Official Juneau School District page publishes schoolboard@juneauschools.org as the Board of Education contact and the district office phone.'},
  {state_code:'AK',county:'Fairbanks North Star Borough',scope:'district',role_key:'it_director',full_name:'Chris Rose',title:'Director of Network Services',email:'chris.rose@k12northstar.org',phone:'907-452-2000 ext. 11285',source_url:'https://www.k12northstar.org/departments/technology/network-computer-services',evidence_note:'Official Fairbanks North Star Borough School District Network Services page identifies Chris Rose as Director of Network Services and publishes direct district email and phone extension.'}
];

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth) return auth;
  const sql=getSql(); let inserted=0,updated=0;
  for(const r of records){
    const existing=await sql.query(`select id from raven_state_contacts where state_code=$1 and regexp_replace(lower(coalesce(county,'')),'\\s+(county|municipality|city and borough|borough)$','')=regexp_replace(lower(coalesce($2,'')),'\\s+(county|municipality|city and borough|borough)$','') and scope=$3 and role_key=$4 limit 1`,[r.state_code,r.county,r.scope,r.role_key]) as any[];
    if(existing.length){
      await sql.query(`update raven_state_contacts set full_name=$1,title=$2,email=$3,phone=$4,source_url=$5,verification_status='verified',verified_at=now(),evidence_note=$6,updated_at=now() where id=$7`,[r.full_name,r.title,r.email,r.phone,r.source_url,r.evidence_note,existing[0].id]); updated++;
    } else {
      await sql.query(`insert into raven_state_contacts(state_code,county,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified',now(),$10)`,[r.state_code,r.county,r.scope,r.role_key,r.full_name,r.title,r.email,r.phone,r.source_url,r.evidence_note]); inserted++;
    }
  }
  const counts=await sql.query(`select state_code,count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code in ('AL','AK') group by state_code order by state_code`) as any[];
  console.log('RAVEN_OFFICIAL_SEED',JSON.stringify({inserted,updated,counts}));
  return NextResponse.json({ok:true,inserted,updated,counts});
}
