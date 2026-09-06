import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://www.ussaut.org/staff/";
const CHECKED = "Authoritative Utah School Superintendents Association statewide superintendent roster checked; no matching published superintendent for this district in this source.";
const BATCH_SIZE = 250;

type Contact = { district:string; fullName:string; email:string; phone:string };

function clean(v:any){ return String(v ?? "").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function validEmail(v:string){ return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(clean(v)); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,"").replace(/\s*[-,]\s*Superintendent.*$/i,"").trim(); }
function districtKey(v:string){
  return clean(v).toLowerCase().replace(/&/g," and ")
    .replace(/\b(public|community|consolidated|independent|county|city|school|schools|district|isd|csd|usd|charter|academy)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function sameDistrict(slot:any, contact:Contact){
  const dk=districtKey(contact.district), ak=districtKey(slot.canonical_name||""), ck=districtKey(slot.county||"");
  return !!dk && (ak===dk || ck===dk || (ak&&ak.includes(dk)) || (dk&&ak&&dk.includes(ak)));
}

async function fetchUtah():Promise<{contacts:Contact[]; diagnostics:any}>{
  const res=await fetch(SOURCE,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/8.3; authoritative-superintendent-association)",accept:"text/html,application/xhtml+xml"}});
  if(!res.ok) throw new Error(`Utah USSA superintendent roster HTTP ${res.status}`);
  const html=await res.text();
  const $=cheerio.load(html);
  const contacts:Contact[]=[];

  $("a[href^='mailto:']").each((_,el)=>{
    const href=clean($(el).attr("href")||"");
    const email=clean(href.replace(/^mailto:/i,"").split("?")[0]);
    if(!validEmail(email)) return;
    let node=$(el).parent();
    let block="";
    for(let i=0;i<7 && node.length;i++,node=node.parent()){
      const t=clean(node.text());
      if(/superintendent/i.test(t) && /district/i.test(t) && t.length<1200){ block=t; break; }
    }
    if(!block) return;
    const districtMatch=block.match(/([A-Za-z0-9 .&'’\/-]+?\sDistrict)\b/i);
    const superMatch=block.match(/([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){1,3})\s*[-,]?\s*Superintendent\b/i);
    if(!districtMatch || !superMatch) return;
    const district=clean(districtMatch[1]);
    const fullName=person(superMatch[1]);
    if(!district || !fullName) return;
    const phoneMatch=block.match(/(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/);
    contacts.push({district,fullName,email,phone:clean(phoneMatch?.[0]||"")});
  });

  const unique=new Map<string,Contact>();
  for(const c of contacts){ const k=districtKey(c.district); if(k && !unique.has(k)) unique.set(k,c); }
  if(unique.size<30) throw new Error(`Utah USSA confidence guard: only ${unique.size} superintendent records parsed from current statewide roster; htmlBytes=${html.length}`);
  return {contacts:[...unique.values()],diagnostics:{htmlBytes:html.length,parsed:unique.size}};
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const counts=async()=> (await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const before=await counts();
  const slots=await sql.query(`select c.id::text,c.county,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='UT' and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' and coalesce(c.evidence_note,'')<>$1 order by coalesce(c.updated_at,c.created_at) asc,c.id asc limit $2`,[CHECKED,BATCH_SIZE]) as any[];
  if(slots.length===0){ const after=await counts(); const summary={ok:true,state:"UT",source:SOURCE,districtsNewlyAttempted:0,matched:0,filled:0,unmatched:0,remainingUnattempted:0,exhaustedCurrentSource:true,before,after,net:{total:0,verified:0,candidate:0,missing:0,rejected:0}}; console.log("RAVEN_UT_AUTHORITATIVE",summary); return NextResponse.json(summary); }

  let parsed:{contacts:Contact[];diagnostics:any};
  try{ parsed=await fetchUtah(); }catch(error){ const blocker=error instanceof Error?error.message:String(error); console.error("RAVEN_UT_AUTHORITATIVE_FETCH",blocker); return NextResponse.json({ok:false,state:"UT",source:SOURCE,blocker,before},{status:502}); }

  let matched=0,filled=0,unmatched=0;
  for(const s of slots){
    const contact=parsed.contacts.find(r=>sameDistrict(s,r));
    if(contact){
      matched++;
      const u=await sql.query(`update raven_state_contacts set full_name=$2,title='Superintendent',email=$3,phone=nullif($4,''),source_url=$5,verification_status='candidate',evidence_note='Utah superintendent and published email listed in the current Utah School Superintendents Association statewide roster; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[s.id,contact.fullName,contact.email,contact.phone,SOURCE]) as any[];
      filled+=u.length;
    }else{
      unmatched++;
      await sql.query(`update raven_state_contacts set evidence_note=$2,updated_at=now() where id=$1 and verification_status='missing'`,[s.id,CHECKED]);
    }
  }

  const remaining=Number((await sql.query(`select count(*)::int n from raven_state_contacts where state_code='UT' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'')<>$1`,[CHECKED]) as any[])[0]?.n||0);
  const after=await counts();
  const summary={ok:true,state:"UT",source:SOURCE,fetched:parsed.contacts.length,districtsNewlyAttempted:slots.length,matched,filled,unmatched,remainingUnattempted:remaining,exhaustedCurrentSource:remaining===0,diagnostics:parsed.diagnostics,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_UT_AUTHORITATIVE",summary);
  return NextResponse.json(summary);
}
