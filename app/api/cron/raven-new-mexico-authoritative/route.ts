import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://webed.ped.state.nm.us/sites/schooldirectory/Lists/Superintendents/AllItems.aspx";
const CHECKED = "Authoritative New Mexico PED superintendent directory checked; no matching published superintendent for this district in this source.";
const BATCH_SIZE = 250;

type Contact = { district:string; fullName:string; email:string; phone:string };

function clean(v:any){ return String(v ?? "").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function validEmail(v:string){ return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(clean(v)); }
function key(v:string){ return clean(v).toLowerCase().replace(/&/g," and ").replace(/\b(public|community|consolidated|independent|municipal|school|schools|district|charter|academy|cons)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim(); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,""); }

async function fetchPage(pageFirstRow:number):Promise<Contact[]> {
  const url = `${SOURCE}?PageFirstRow=${pageFirstRow}&Paged=TRUE`;
  const res = await fetch(url,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/8.0; authoritative-state-roster)",accept:"text/html,application/xhtml+xml"}});
  if(!res.ok) throw new Error(`New Mexico PED directory HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  const out:Contact[]=[];
  $("tr").each((_,el)=>{
    const cells=$(el).find("td,th").map((__,c)=>clean($(c).text())).get().filter(Boolean);
    if(cells.length<4) return;
    const email=cells.find(validEmail)||"";
    if(!email) return;
    const codeIndex=cells.findIndex(c=>/^\d{3}$/.test(c));
    if(codeIndex<=0 || codeIndex+1>=cells.length) return;
    const district=cells[codeIndex-1];
    let fullName="";
    for(let i=codeIndex+1;i<Math.min(cells.length,codeIndex+5);i++){
      const candidate=person(cells[i]);
      if(candidate && !validEmail(candidate) && !/\d{3}/.test(candidate) && candidate.length>=4 && candidate.length<=80){ fullName=candidate; break; }
    }
    const phone=cells.find(c=>/\(?\d{3}\)?[^\d]*\d{3}[^\d]*\d{4}/.test(c))||"";
    if(!district || !fullName) return;
    out.push({district,fullName,email,phone});
  });
  return out;
}

async function roster():Promise<Contact[]> {
  const starts=Array.from({length:10},(_,i)=>1+i*30);
  const pages=await Promise.all(starts.map(fetchPage));
  const map=new Map<string,Contact>();
  for(const c of pages.flat()){
    const k=key(c.district);
    if(k && !map.has(k)) map.set(k,c);
  }
  if(map.size===0) throw new Error("New Mexico PED directory parsed zero reachable superintendents; refusing to advance durable queue");
  return [...map.values()];
}

function same(slot:any,c:Contact){
  const dk=key(c.district), ak=key(slot.canonical_name||""), ck=key(slot.county||"");
  return !!dk && (ak===dk || ck===dk || (ak && (ak.includes(dk)||dk.includes(ak))));
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const available=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='NM' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'') <> $1`,[CHECKED]) as any[])[0]?.n||0;
  if(available===0){
    const summary={ok:true,state:"NM",source:SOURCE,skippedFetch:true,districtsNewlyAttempted:0,matched:0,filled:0,unmatched:0,remainingUnattempted:0,exhaustedCurrentSource:true,before,after:before,net:{total:0,verified:0,candidate:0,missing:0,rejected:0}};
    console.log("RAVEN_NM_AUTHORITATIVE",summary); return NextResponse.json(summary);
  }
  let contacts:Contact[]=[];
  try{ contacts=await roster(); }
  catch(err){ const blocker=err instanceof Error?err.message:String(err); console.error("RAVEN_NM_AUTHORITATIVE_FETCH",blocker); return NextResponse.json({ok:false,state:"NM",blocker,before},{status:502}); }
  const slots=await sql.query(`select c.id::text,c.county,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='NM' and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' and coalesce(c.evidence_note,'') <> $1 order by coalesce(c.updated_at,c.created_at) asc,c.id asc limit $2`,[CHECKED,BATCH_SIZE]) as any[];
  let matched=0,filled=0,unmatched=0;
  for(const s of slots){
    const c=contacts.find(x=>same(s,x));
    if(c){
      matched++;
      const u=await sql.query(`update raven_state_contacts set full_name=$2,title='Superintendent',email=$3,phone=nullif($4,''),source_url=$5,verification_status='candidate',evidence_note='Superintendent and email published in the official New Mexico Public Schools Directory maintained by NMPED; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[s.id,c.fullName,c.email,c.phone,SOURCE]) as any[];
      filled+=u.length;
    } else {
      unmatched++;
      await sql.query(`update raven_state_contacts set evidence_note=$2,updated_at=now() where id=$1 and verification_status='missing'`,[s.id,CHECKED]);
    }
  }
  const remaining=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='NM' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'') <> $1`,[CHECKED]) as any[])[0]?.n||0;
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const summary={ok:true,state:"NM",source:SOURCE,fetched:contacts.length,districtsNewlyAttempted:slots.length,matched,filled,unmatched,remainingUnattempted:remaining,exhaustedCurrentSource:remaining===0,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_NM_AUTHORITATIVE",summary); return NextResponse.json(summary);
}
