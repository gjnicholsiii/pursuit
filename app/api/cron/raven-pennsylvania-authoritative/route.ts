import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE = "https://www.edna.pa.gov/Screens/wfSearchEntityResults.aspx?AUN=&CID=-1&CategoryIDs=1%2C&City=&CurrentName=&HistoricalName=&IU=-1&SchoolBranch=&StatusIDs=1%2C";
const CHECKED = "Authoritative Pennsylvania EdNA school-district directory checked; no matching reachable superintendent for this district in this source.";

type Contact = { district:string; fullName:string; title:string; email:string; phone:string; sourceUrl:string };

function clean(v:string){ return v.replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function validEmail(v:string){ return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(v); }
function districtKey(v:string){
  return clean(v).toLowerCase().replace(/&/g," and ")
    .replace(/\b(area|borough|township|city|county|school|schools|district|sd)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function person(v:string){ return clean(v).replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i,"").replace(/\s*,\s*(acting|substitute|interim)?\s*superintendent.*$/i,"").trim(); }

async function fetchPage(page:number):Promise<Contact[]> {
  const url = `${BASE}&ctl00_MainContent_grdSearchResultsChangePage=${page}_20`;
  const res = await fetch(url,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/6.0; authoritative-public-directory)",accept:"text/html,application/xhtml+xml"}});
  if(!res.ok) throw new Error(`PA EdNA page ${page} HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  const out:Contact[]=[];
  $("table tr").each((_,tr)=>{
    const cells=$(tr).find("th,td").map((__,td)=>clean($(td).text())).get();
    if(cells.length < 8) return;
    const joined=cells.join(" | ");
    if(/Institution Name.*Administrative Unit/i.test(joined)) return;
    const district=cells[0]||"";
    if(!district || !/\bSD\b|School District/i.test(district)) return;
    const phone=cells.find(c=>/\(?\d{3}\)?[^\d]*\d{3}[^\d]*\d{4}/.test(c))||"";
    const email=cells.find(validEmail)||"";
    const admin=cells.find(c=>/superintendent/i.test(c))||"";
    if(!admin || (!phone && !email)) return;
    const titleMatch=admin.match(/,\s*([^,]*superintendent[^,]*)$/i);
    const title=clean(titleMatch?.[1]||"Superintendent");
    const fullName=person(admin);
    if(!fullName) return;
    out.push({district,fullName,title,email:validEmail(email)?email:"",phone,sourceUrl:url});
  });
  return out;
}

async function fetchRoster(){
  const pages:number[][]=[];
  for(let i=1;i<=25;i+=5) pages.push([i,i+1,i+2,i+3,i+4]);
  const all:Contact[]=[];
  for(const group of pages){
    const settled=await Promise.allSettled(group.filter(p=>p<=25).map(fetchPage));
    for(const s of settled) if(s.status==="fulfilled") all.push(...s.value);
  }
  const dedup=new Map<string,Contact>();
  for(const c of all) dedup.set(districtKey(c.district),c);
  return [...dedup.values()];
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth) return auth;
  const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];

  const remainingBefore=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='PA' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'')<>$1`,[CHECKED]) as any[])[0]?.n||0;
  if(remainingBefore===0) return NextResponse.json({ok:true,state:"PA",skipped:true,reason:"source exhausted",before,after:before,districtsNewlyAttempted:0,filled:0});

  let roster:Contact[]=[];
  try{ roster=await fetchRoster(); }
  catch(err){ return NextResponse.json({ok:false,state:"PA",blocker:err instanceof Error?err.message:String(err),before},{status:502}); }
  if(roster.length<100) return NextResponse.json({ok:false,state:"PA",blocker:`EdNA parser returned only ${roster.length} reachable district superintendents; refusing to consume queue`,before},{status:502});

  const slots=await sql.query(`select c.id::text,c.county,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='PA' and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' and coalesce(c.evidence_note,'')<>$1 order by coalesce(c.updated_at,c.created_at) asc,c.id asc limit 500`,[CHECKED]) as any[];
  const byKey=new Map(roster.map(r=>[districtKey(r.district),r]));
  let filled=0,matched=0,unmatched=0;
  for(const s of slots){
    const ak=districtKey(s.canonical_name||""); const ck=districtKey(s.county||"");
    let c=byKey.get(ak)||byKey.get(ck);
    if(!c) c=roster.find(r=>{const rk=districtKey(r.district);return !!rk&&((ak&&ak.includes(rk))||(rk&&ak&&rk.includes(ak)));});
    if(c){
      matched++;
      const u=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=nullif($4,''),phone=nullif($5,''),source_url=$6,verification_status='candidate',evidence_note='Reachable superintendent from official Pennsylvania Department of Education EdNA district directory; phone or public email explicitly published by EdNA; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[s.id,c.fullName,c.title,c.email,c.phone,c.sourceUrl]) as any[];
      filled+=u.length;
    } else {
      unmatched++;
      await sql.query(`update raven_state_contacts set evidence_note=$2,updated_at=now() where id=$1 and verification_status='missing'`,[s.id,CHECKED]);
    }
  }
  const remaining=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='PA' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'')<>$1`,[CHECKED]) as any[])[0]?.n||0;
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const result={ok:true,state:"PA",source:"Pennsylvania Department of Education EdNA",rosterFetched:roster.length,districtsNewlyAttempted:slots.length,matched,filled,unmatched,remainingUnattempted:remaining,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_PA_AUTHORITATIVE",result);
  return NextResponse.json(result);
}
