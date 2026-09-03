import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const KDE_OPENHOUSE = "https://openhouse.education.ky.gov/Superintendents";
const KDE_SDCI = "https://applications.education.ky.gov/SDCI/District.aspx/1000";
const CHECKED = "Authoritative Kentucky KDE statewide superintendent roster checked for this missing superintendent slot; no matching published district superintendent found.";
const BATCH_SIZE = 50;

type District = { code:string; district:string; superintendent:string; phone:string };
type Slot = { id:string; agency_id:string; county:string|null; canonical_name:string|null; role_key:string };

function clean(v:any){ return String(v ?? "").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function key(v:any){ return clean(v).toLowerCase().replace(/&/g," and ").replace(/\b(public|community|consolidated|independent|school|schools|district|county|city)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim(); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,""); }
function phone(v:string){ const m=clean(v).match(/\(?\d{3}\)?[^\d]*\d{3}[^\d]*\d{4}/); return m?m[0]:""; }

async function fetchHtml(url:string,timeoutMs=15000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(url,{cache:"no-store",redirect:"follow",signal:controller.signal,headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/9.3; authoritative-public-directory)",accept:"text/html,application/xhtml+xml"}});
    if(!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return {url:res.url||url,html:await res.text()};
  } finally { clearTimeout(timer); }
}

function parseDistricts(html:string):District[]{
  const $=cheerio.load(html);
  const out:District[]=[];
  $("tr").each((_,tr)=>{
    const cells=$(tr).find("th,td").map((__,td)=>clean($(td).text())).get().filter(Boolean);
    if(cells.length<3) return;
    const codeIndex=cells.findIndex(v=>/^\d{3,4}$/.test(v));
    if(codeIndex<0) return;
    const code=cells[codeIndex];
    const district=cells[codeIndex+1]||"";
    const superintendent=person(cells[codeIndex+2]||"");
    const p=cells.map(phone).find(Boolean)||"";
    if(district && superintendent && !/superintendent/i.test(superintendent)) out.push({code,district,superintendent,phone:p});
  });
  return [...new Map(out.map(x=>[key(x.district),x])).values()];
}

async function districts():Promise<{list:District[];source:string;errors:string[]}>{
  const errors:string[]=[];
  for(const source of [KDE_OPENHOUSE,KDE_SDCI]){
    try{
      const {html}=await fetchHtml(source);
      const list=parseDistricts(html);
      if(list.length>=150) return {list,source,errors};
      errors.push(`${source} parsed only ${list.length} districts`);
    }catch(err){ errors.push(err instanceof Error?err.message:String(err)); }
  }
  throw new Error(`Kentucky KDE roster unavailable or incomplete; ${errors.join(" | ")}`);
}

function matchDistrict(slot:Slot,list:District[]){
  const ak=key(slot.canonical_name), ck=key(slot.county);
  return list.find(d=>{
    const dk=key(d.district);
    return dk && (dk===ak || dk===ck || (ak&&ak.includes(dk)) || (dk&&ak&&dk.includes(ak)));
  })||null;
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];

  let list:District[]=[]; let source=""; let sourceErrors:string[]=[];
  try{ const roster=await districts(); list=roster.list; source=roster.source; sourceErrors=roster.errors; }
  catch(err){
    const blocker=err instanceof Error?err.message:String(err);
    console.error("RAVEN_KY_AUTHORITATIVE_FETCH",blocker);
    return NextResponse.json({ok:false,state:"KY",blocker,before},{status:502});
  }

  const slots=await sql.query(`select c.id::text,c.agency_id::text,c.county,c.role_key,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='KY' and c.scope='district' and c.verification_status='missing' and c.role_key='superintendent' and coalesce(c.evidence_note,'') <> $1 order by coalesce(c.updated_at,c.created_at) asc,c.id asc limit $2`,[CHECKED,BATCH_SIZE]) as Slot[];

  let matched=0,filled=0,unmatched=0;
  const districtsAttempted=new Set<string>();
  for(const s of slots){
    const d=matchDistrict(s,list);
    if(d) districtsAttempted.add(d.code);
    if(d && d.superintendent && d.phone){
      matched++;
      const u=await sql.query(`update raven_state_contacts set full_name=$2,title='School District Superintendent',email=null,phone=$3,source_url=$4,verification_status='candidate',evidence_note='Superintendent identity and district phone published by the Kentucky Department of Education statewide superintendent directory; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[s.id,d.superintendent,d.phone,source]) as any[];
      filled+=u.length;
    } else {
      unmatched++;
      await sql.query(`update raven_state_contacts set evidence_note=$2,updated_at=now() where id=$1 and verification_status='missing'`,[s.id,CHECKED]);
    }
  }

  const remaining=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='KY' and scope='district' and verification_status='missing' and role_key='superintendent' and coalesce(evidence_note,'') <> $1`,[CHECKED]) as any[])[0]?.n||0;
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const summary={ok:true,state:"KY",source,sourceFallbackErrors:sourceErrors,districtRoster:list.length,slotsNewlyAttempted:slots.length,districtsNewlyAttempted:districtsAttempted.size,matched,filled,unmatched,remainingUnattempted:remaining,exhaustedCurrentSource:remaining===0,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_KY_AUTHORITATIVE",summary);
  return NextResponse.json(summary);
}
