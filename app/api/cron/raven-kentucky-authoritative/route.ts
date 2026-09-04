import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const KDE_OPENHOUSE = "https://openhouse.education.ky.gov/Superintendents";
const KDE_EXPORT = "https://applications.education.ky.gov/SDCI/Download.aspx?DCD=2703&d=true&qt=D";
const KDE_SDCI = "https://applications.education.ky.gov/SDCI/District.aspx/1000";
const CHECKED = "Authoritative Kentucky KDE statewide superintendent roster checked for this missing superintendent slot; no matching published district superintendent found.";
const BATCH_SIZE = 250;

type District = { code:string; district:string; superintendent:string; phone:string };
type Slot = { id:string; agency_id:string; county:string|null; canonical_name:string|null; role_key:string };

function clean(v:any){ return String(v ?? "").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function key(v:any){ return clean(v).toLowerCase().replace(/&/g," and ").replace(/\b(public|community|consolidated|independent|school|schools|district|county|city)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim(); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,""); }
function phone(v:string){ const m=clean(v).match(/\(?\d{3}\)?[^\d]*\d{3}[^\d]*\d{4}/); return m?m[0]:""; }

async function fetchText(url:string,timeoutMs=15000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(url,{cache:"no-store",redirect:"follow",signal:controller.signal,headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/9.4; authoritative-public-directory)",accept:"text/html,text/csv,application/csv,application/octet-stream,*/*"}});
    if(!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return {url:res.url||url,text:await res.text(),contentType:res.headers.get("content-type")||""};
  } finally { clearTimeout(timer); }
}

function parseDistricts(html:string):District[]{
  const $=cheerio.load(html);
  const out:District[]=[];
  $("tr").each((_,tr)=>{
    const cells=$(tr).find("th,td").map((__,td)=>clean($(td).text())).get();
    if(cells.length<3) return;
    const codeIndex=cells.findIndex(v=>/^\d{1,4}$/.test(v));
    if(codeIndex<0) return;
    const code=clean(cells[codeIndex]).padStart(3,"0");
    const district=clean(cells[codeIndex+1]||"");
    const superintendent=person(cells[codeIndex+2]||"");
    const p=cells.map(phone).find(Boolean)||"";
    if(district && superintendent && !/superintendent/i.test(superintendent)) out.push({code,district,superintendent,phone:p});
  });
  return [...new Map(out.map(x=>[key(x.district),x])).values()];
}

function csvRows(text:string):string[][]{
  const rows:string[][]=[]; let row:string[]=[]; let field=""; let quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"' && text[i+1]==='"'){ field+='"'; i++; }
      else if(ch==='"') quoted=false;
      else field+=ch;
    }else{
      if(ch==='"') quoted=true;
      else if(ch===','){ row.push(field); field=""; }
      else if(ch==='\n'){ row.push(field); rows.push(row); row=[]; field=""; }
      else if(ch!=='\r') field+=ch;
    }
  }
  if(field.length||row.length){ row.push(field); rows.push(row); }
  return rows;
}

function parseDistrictCsv(text:string):District[]{
  const rows=csvRows(text).filter(r=>r.some(Boolean));
  if(!rows.length) return [];
  const header=rows[0].map(v=>clean(v).toLowerCase());
  const idx=(patterns:RegExp[])=>header.findIndex(h=>patterns.some(p=>p.test(h)));
  const codeI=idx([/district.*code/,/^code$/]);
  const districtI=idx([/^district$/,/district.*name/]);
  const superI=idx([/superintendent/]);
  const phoneI=idx([/^phone$/,/telephone/]);
  const out:District[]=[];
  for(const r of rows.slice(1)){
    const code=clean(r[codeI]||"").replace(/\D/g,"").padStart(3,"0");
    const district=clean(r[districtI]||"");
    const superintendent=person(r[superI]||"");
    const p=phone(r[phoneI]||"") || r.map(phone).find(Boolean) || "";
    if(code && district && superintendent && p && !/superintendent/i.test(superintendent)) out.push({code,district,superintendent,phone:p});
  }
  return [...new Map(out.map(x=>[key(x.district),x])).values()];
}

async function districts():Promise<{list:District[];source:string;errors:string[]}>{
  const errors:string[]=[];
  for(const source of [KDE_OPENHOUSE,KDE_EXPORT,KDE_SDCI]){
    try{
      const fetched=await fetchText(source);
      const csvLike=/csv|octet-stream/i.test(fetched.contentType) || (!/<html|<table|<!doctype/i.test(fetched.text.slice(0,500)) && fetched.text.includes(','));
      const list=csvLike?parseDistrictCsv(fetched.text):parseDistricts(fetched.text);
      if(list.length>=5) return {list,source,errors};
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

  let matched=0,filled=0;
  const districtsAttempted=new Set<string>();
  for(const s of slots){
    const d=matchDistrict(s,list);
    if(!d) continue;
    districtsAttempted.add(d.code);
    matched++;
    if(d.superintendent && d.phone){
      const u=await sql.query(`update raven_state_contacts set full_name=$2,title='School District Superintendent',email=null,phone=$3,source_url=$4,verification_status='candidate',evidence_note='Superintendent identity and district phone published by the Kentucky Department of Education superintendent directory; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[s.id,d.superintendent,d.phone,source]) as any[];
      filled+=u.length;
    }
  }

  const remaining=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='KY' and scope='district' and verification_status='missing' and role_key='superintendent'`,[]) as any[])[0]?.n||0;
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const summary={ok:true,state:"KY",source,sourceFallbackErrors:sourceErrors,districtRoster:list.length,slotsScanned:slots.length,slotsNewlyAttempted:matched,districtsNewlyAttempted:districtsAttempted.size,matched,filled,unmatchedMarkedChecked:0,remainingMissingSuperintendent:remaining,partialAuthoritativePage:list.length<150,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_KY_AUTHORITATIVE",summary);
  return NextResponse.json(summary);
}
