import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INDEX = "https://www.cde.ca.gov/ds/si/ds/pubschls.asp";
const CHECKED = "Authoritative California CDE Public Districts statewide file checked; no matching published reachable superintendent for this district in this source.";
const BATCH_SIZE = 250;

type Contact = { district:string; fullName:string; phone:string };

function clean(v:string){ return (v || "").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,""); }
function districtKey(v:string){
  return clean(v).toLowerCase().replace(/&/g," and ")
    .replace(/\b(public|community|consolidated|independent|county|city|school|schools|district|union|unified|elementary|high)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}

async function california():Promise<{sourceUrl:string;contacts:Contact[]}> {
  const indexRes = await fetch(INDEX,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/6.0; authoritative-state-roster)",accept:"text/html,application/xhtml+xml"}});
  if(!indexRes.ok) throw new Error(`California CDE data index HTTP ${indexRes.status}`);
  const $ = cheerio.load(await indexRes.text());
  let href = "";
  $("a").each((_,a)=>{
    const text=clean($(a).text());
    if(!href && /Public Districts/i.test(text) && /TXT/i.test(text)) href=$(a).attr("href")||"";
  });
  if(!href){
    $("a").each((_,a)=>{
      const text=clean($(a).text());
      const context=clean($(a).parent().text()+" "+$(a).closest("li").text());
      if(!href && /TXT/i.test(text) && /Public Districts/i.test(context)) href=$(a).attr("href")||"";
    });
  }
  if(!href) throw new Error("California CDE Public Districts TXT link not found");
  const sourceUrl = new URL(href, INDEX).toString();
  const res=await fetch(sourceUrl,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/6.0; authoritative-state-roster)",accept:"text/plain,text/tab-separated-values,*/*"}});
  if(!res.ok) throw new Error(`California CDE Public Districts HTTP ${res.status}`);
  const text=await res.text();
  const lines=text.split(/\r?\n/).filter(Boolean);
  if(lines.length<2) throw new Error("California CDE Public Districts file empty");
  const header=lines[0].split("\t").map(x=>clean(x).toLowerCase());
  const idx=(rx:RegExp)=>header.findIndex(h=>rx.test(h));
  const di=idx(/^district$/), fi=idx(/^admfname$/), li=idx(/^admlname$/), pi=idx(/^phone$/);
  if([di,fi,li,pi].some(i=>i<0)) throw new Error(`California CDE required columns missing: ${header.join(",")}`);
  const contacts:Contact[]=[];
  for(const line of lines.slice(1)){
    const c=line.split("\t").map(clean);
    const district=c[di]||"";
    const fullName=person(`${c[fi]||""} ${c[li]||""}`);
    const phone=c[pi]||"";
    if(district && fullName && /\d{3}.*\d{3}.*\d{4}/.test(phone)) contacts.push({district,fullName,phone});
  }
  return {sourceUrl,contacts:[...new Map(contacts.map(x=>[districtKey(x.district),x])).values()]};
}

function sameDistrict(slot:any, contact:Contact){
  const dk=districtKey(contact.district), ak=districtKey(slot.canonical_name||""), ck=districtKey(slot.county||"");
  return !!dk && (ak===dk || ck===dk || (ak&&ak.includes(dk)) || (dk&&ak&&dk.includes(ak)));
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const available=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='CA' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'') <> $1`,[CHECKED]) as any[])[0]?.n||0;
  if(available===0){
    const summary={ok:true,state:"CA",source:INDEX,skippedFetch:true,districtsNewlyAttempted:0,matched:0,filled:0,unmatched:0,remainingUnattempted:0,exhaustedCurrentSource:true,before,after:before,net:{total:0,verified:0,candidate:0,missing:0,rejected:0}};
    console.log("RAVEN_CA_AUTHORITATIVE",summary); return NextResponse.json(summary);
  }
  let sourceUrl=INDEX, roster:Contact[]=[];
  try{ const result=await california(); sourceUrl=result.sourceUrl; roster=result.contacts; }
  catch(err){ const blocker=err instanceof Error?err.message:String(err); console.error("RAVEN_CA_AUTHORITATIVE_FETCH",blocker); return NextResponse.json({ok:false,state:"CA",blocker,before},{status:502}); }
  const slots=await sql.query(`select c.id::text,c.county,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='CA' and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' and coalesce(c.evidence_note,'') <> $1 order by coalesce(c.updated_at,c.created_at) asc,c.id asc limit $2`,[CHECKED,BATCH_SIZE]) as any[];
  let matched=0,filled=0,unmatched=0;
  for(const s of slots){
    const contact=roster.find(r=>sameDistrict(s,r));
    if(contact){
      matched++;
      const u=await sql.query(`update raven_state_contacts set full_name=$2,title='Superintendent',email=null,phone=$3,source_url=$4,verification_status='candidate',evidence_note='California superintendent and district phone published in the official CDE real-time Public Districts statewide file; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[s.id,contact.fullName,contact.phone,sourceUrl]) as any[];
      filled+=u.length;
    } else {
      unmatched++;
      await sql.query(`update raven_state_contacts set evidence_note=$2,updated_at=now() where id=$1 and verification_status='missing'`,[s.id,CHECKED]);
    }
  }
  const remaining=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='CA' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'') <> $1`,[CHECKED]) as any[])[0]?.n||0;
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const summary={ok:true,state:"CA",source:sourceUrl,fetched:roster.length,districtsNewlyAttempted:slots.length,matched,filled,unmatched,remainingUnattempted:remaining,exhaustedCurrentSource:remaining===0,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_CA_AUTHORITATIVE",summary); return NextResponse.json(summary);
}
