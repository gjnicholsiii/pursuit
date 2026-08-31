import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BANNED = /\b(facilit(?:y|ies)|plant|maintenance|buildings?\s*(?:&|and)\s*grounds|procurement|purchasing|finance|financial|principal|teacher|operations?|transportation|food service|human resources|\bhr\b)\b/i;
const STRICT: Record<string, RegExp> = {
  security_director: /\b(?:director|chief|executive director)\b.{0,60}\b(?:security|school safety|public safety|safety and security|security and safety)\b|\b(?:security|school safety|public safety|safety and security|security and safety)\b.{0,60}\b(?:director|chief|executive director)\b/i,
  superintendent: /^((?!assistant|deputy|associate).)*\bsuperintendent\b/i,
  assistant_superintendent: /\b(?:assistant|asst\.?)\s+superintendent\b/i,
  it_director: /\b(?:director|executive director|chief information officer|cio)\b.{0,60}\b(?:information technology|technology|information systems|it services|network services)\b|\b(?:information technology|technology|information systems|it services|network services)\b.{0,60}\b(?:director|chief information officer|cio)\b/i,
  school_board: /\b(?:school\s+)?board\s+(?:member|chair|chairman|chairwoman|president|vice president|trustee)\b|\bboard trustee\b/i,
};

const seeds = [
  ['AL','Blount','district','superintendent','Rodney Green','Superintendent','rgreen@blountboe.net','205-775-1950','https://www.blountboe.net/link-3','Official Blount County Schools directory lists Rodney Green as Superintendent with direct district email.'],
  ['AL','Blount','district','assistant_superintendent','Christopher Lakey','Assistant Superintendent','clakey@blountboe.net','205-775-1950','https://www.blountboe.net/link-3','Official Blount County Schools directory lists Christopher Lakey as Assistant Superintendent with direct district email.'],
  ['AL','Blount','district','it_director','Brad Williams','Technology Director','bdwilliams@blountboe.net','205-775-1950','https://www.blountboe.net/departments/technology','Official Blount County Schools Technology page lists Brad Williams as Technology Director with direct district email.'],
  ['AL','Blount','district','school_board','Chris Latta','Board Member, President, District V',null,'205-775-1950','https://www.blountboe.net/about-us/school-board','Official Blount County Schools School Board page lists Chris Latta as Board Member and President; no individual email published on cited page.'],
  ['AK',null,'state','state_security_director','Pat Sidmore','Program Coordinator II — School Health and School Emergency Management',null,'907-465-2939','https://education.alaska.gov/safeschools/safeandemerg','Alaska DEED School Safety and Emergency Management page identifies Pat Sidmore as Program Coordinator II and contact for school emergency management.'],
  ['AK','Anchorage Municipality','district','superintendent','Dr. Jharrett Bryantt','Superintendent','officeofthesuperintendent@asdk12.org','907-742-4312','https://www.asdk12.org/aboutasd/superintendent','Official Anchorage School District superintendent page identifies Dr. Jharrett Bryantt and publishes office email and phone.'],
  ['AK','Anchorage Municipality','district','it_director','Mike Fleckenstein','Chief Information Officer',null,'907-742-1584','https://www.asdk12.org/departments/information-technology','Official Anchorage School District IT page identifies Mike Fleckenstein as Chief Information Officer and publishes phone; no direct personal email on cited page.'],
  ['AK','Anchorage Municipality','district','school_board','Carl Jacobs','School Board President','jacobs_carl@asdk12.org','907-742-1101 ext. 5','https://www.asdk12.org/school-board/board-members','Official Anchorage School District Board Members page identifies Carl Jacobs as School Board President and publishes individual district email and phone extension.'],
  ['AK','Juneau City and Borough','district','superintendent','Shawn Arnold','Superintendent of Schools',null,'907-523-1700','https://www.juneauschools.org/en-US','Official Juneau School District page identifies Shawn Arnold as Superintendent of Schools and publishes district office phone.'],
  ['AK','Juneau City and Borough','district','school_board','Juneau Board of Education','Board of Education','schoolboard@juneauschools.org','907-523-1700','https://www.juneauschools.org/en-US','Official Juneau School District page publishes the Board of Education group email and district office phone.'],
  ['AK','Fairbanks North Star Borough','district','it_director','Chris Rose','Director of Network Services','chris.rose@k12northstar.org','907-452-2000 ext. 11285','https://www.k12northstar.org/departments/technology/network-computer-services','Official Fairbanks North Star Borough School District page identifies Chris Rose as Director of Network Services and publishes direct email and phone.']
] as const;

function norm(v:string){return v.toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function host(v:string|null){if(!v)return'';try{return new URL(/^https?:\/\//i.test(v)?v:`https://${v}`).hostname.toLowerCase().replace(/^www\./,'');}catch{return'';}}
function relatedHost(a:string,b:string){return !!a&&!!b&&(a===b||a.endsWith(`.${b}`)||b.endsWith(`.${a}`));}
async function fetchText(url:string){const c=new AbortController();const t=setTimeout(()=>c.abort(),12000);try{const r=await fetch(url,{redirect:'follow',cache:'no-store',signal:c.signal,headers:{'user-agent':'Mozilla/5.0 (compatible; Pursuit-Raven-Verifier/1.0; public-contact-verification)',accept:'text/html,application/xhtml+xml'}});if(!r.ok)return null;const type=(r.headers.get('content-type')||'').toLowerCase();if(!type.includes('html')&&!type.includes('text'))return null;return{text:norm(cheerio.load(await r.text())('body').text()),finalUrl:r.url||url};}catch{return null;}finally{clearTimeout(t);}}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req);if(auth)return auth;const sql=getSql();
  let seeded=0;
  for(const r of seeds){
    const [state,county,scope,role,name,title,email,phone,url,note]=r;
    const existing=await sql.query(`select id from raven_state_contacts where state_code=$1 and regexp_replace(lower(coalesce(county,'')),'\\s+(county|municipality|city and borough|borough)$','')=regexp_replace(lower(coalesce($2,'')),'\\s+(county|municipality|city and borough|borough)$','') and scope=$3 and role_key=$4 order by case when verification_status='verified' then 0 else 1 end,id limit 1`,[state,county,scope,role]) as any[];
    if(existing.length){await sql.query(`update raven_state_contacts set full_name=$1,title=$2,email=$3,phone=$4,source_url=$5,verification_status='verified',verified_at=now(),evidence_note=$6,updated_at=now() where id=$7`,[name,title,email,phone,url,note,existing[0].id]);}
    else {await sql.query(`insert into raven_state_contacts(state_code,county,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified',now(),$10)`,[state,county,scope,role,name,title,email,phone,url,note]);}
    seeded++;
  }

  const removed=await sql.query(`delete from raven_state_contacts m where m.verification_status='missing' and m.full_name is null and exists(select 1 from raven_state_contacts x where x.id<>m.id and x.state_code=m.state_code and regexp_replace(lower(coalesce(x.county,'')),'\\s+(county|municipality|city and borough|borough)$','')=regexp_replace(lower(coalesce(m.county,'')),'\\s+(county|municipality|city and borough|borough)$','') and x.scope=m.scope and x.role_key=m.role_key and x.verification_status in ('candidate','verified') and x.full_name is not null) returning id`) as any[];

  const states=await sql.query(`select state_code from raven_state_contacts group by state_code having count(*) filter(where verification_status in ('missing','candidate'))>0 order by state_code limit 4`) as any[];
  let verified=0,rejected=0,unchanged=0;
  for(const s of states){
    const state=String(s.state_code);
    const candidates=await sql.query(`select c.id::text,c.role_key,c.full_name,c.title,c.source_url,a.website agency_website from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code=$1 and c.verification_status='candidate' and c.full_name is not null and c.title is not null and c.source_url is not null order by c.updated_at asc,c.id limit 16`,[state]) as any[];
    for(const row of candidates){const title=String(row.title||'');const rule=STRICT[String(row.role_key)]||null;if(!rule||BANNED.test(title)||!rule.test(title)){await sql.query(`update raven_state_contacts set verification_status='rejected',evidence_note=$2,updated_at=now() where id=$1`,[row.id,'Rejected by strict outreach-role verifier; title is outside approved school-security contact roles.']);rejected++;continue;}const sourceHost=host(String(row.source_url));const agencyHost=host(row.agency_website?String(row.agency_website):null);if(agencyHost&&!relatedHost(sourceHost,agencyHost)){unchanged++;continue;}const page=await fetchText(String(row.source_url));if(!page){unchanged++;continue;}const finalHost=host(page.finalUrl);if(agencyHost&&!relatedHost(finalHost,agencyHost)){unchanged++;continue;}const nameOk=norm(String(row.full_name)).length>=5&&page.text.includes(norm(String(row.full_name)));const titleOk=norm(title).length>=4&&page.text.includes(norm(title));if(nameOk&&titleOk){await sql.query(`update raven_state_contacts set verification_status='verified',verified_at=now(),evidence_note='Live official organization page revalidated: exact person and title present.',updated_at=now() where id=$1`,[row.id]);verified++;}else unchanged++;}
  }
  const counts=await sql.query(`select state_code,count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts group by state_code order by state_code`) as any[];
  const snapshot={seeded,statesProcessed:states.map((s:any)=>s.state_code),verifiedThisRun:verified,rejectedThisRun:rejected,unchangedThisRun:unchanged,placeholdersRemoved:removed.length,counts};console.log('RAVEN_CONTACT_VERIFY',JSON.stringify(snapshot));return NextResponse.json({ok:true,...snapshot});
}
