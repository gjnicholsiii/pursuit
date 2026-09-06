import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INDEX = "https://schools.utah.gov/schooldistricts";
const CHECKED = "Authoritative Utah State Board of Education statewide district directory CSV export checked; no matching published reachable superintendent for this district in this source.";
const BATCH_SIZE = 250;

type Contact = { district:string; fullName:string; email:string; phone:string };

function clean(v:any){ return String(v ?? "").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function validEmail(v:string){ return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(clean(v)); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,""); }
function districtKey(v:string){
  return clean(v).toLowerCase().replace(/&/g," and ")
    .replace(/\b(public|community|consolidated|independent|county|city|school|schools|district|isd|csd|usd|charter|academy)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function csvFields(line:string){
  const out:string[]=[]; let cur="", q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){ if(q && line[i+1]==='"'){ cur+='"'; i++; } else q=!q; }
    else if(ch===',' && !q){ out.push(clean(cur)); cur=""; }
    else cur+=ch;
  }
  out.push(clean(cur)); return out;
}
function sameDistrict(slot:any, contact:Contact){
  const dk=districtKey(contact.district), ak=districtKey(slot.canonical_name||""), ck=districtKey(slot.county||"");
  return !!dk && (ak===dk || ck===dk || (ak&&ak.includes(dk)) || (dk&&ak&&dk.includes(ak)));
}

async function fetchUtah():Promise<{contacts:Contact[]; exportUrl:string; diagnostics:any}>{
  const res=await fetch(INDEX,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/8.1; authoritative-state-roster)",accept:"text/html,application/xhtml+xml"}});
  if(!res.ok) throw new Error(`Utah USBE district directory HTTP ${res.status}`);
  const html=await res.text();
  const $=cheerio.load(html);
  let exportHref="";
  $("a").each((_,el)=>{
    const text=clean($(el).text()); const href=clean($(el).attr("href")||"");
    if(!exportHref && href && /export\s+to\s+csv/i.test(text)) exportHref=href;
  });
  if(!exportHref){
    const candidates=[...html.matchAll(/href=["']([^"']*(?:csv|export)[^"']*)["']/ig)].map(m=>m[1]);
    exportHref=candidates.find(Boolean)||"";
  }
  if(!exportHref) throw new Error(`Utah USBE CSV export link not resolved from directory HTML; htmlBytes=${html.length}`);
  const exportUrl=new URL(exportHref,INDEX).toString();
  const csvRes=await fetch(exportUrl,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/8.1; authoritative-state-roster)",referer:INDEX,accept:"text/csv,text/plain,application/csv,application/octet-stream,*/*"}});
  if(!csvRes.ok) throw new Error(`Utah USBE CSV export HTTP ${csvRes.status}; url=${exportUrl}`);
  const text=await csvRes.text();
  if(/<html|<!doctype/i.test(text.slice(0,500))) throw new Error(`Utah USBE export returned HTML instead of CSV; url=${exportUrl}; bytes=${text.length}`);
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(l=>l.trim().length>0);
  if(lines.length<2) throw new Error(`Utah USBE CSV export empty; url=${exportUrl}`);
  const delim=lines[0].includes("\t")?"\t":",";
  const parse=(line:string)=>delim==="\t"?line.split("\t").map(clean):csvFields(line);
  const header=parse(lines[0]).map(h=>clean(h).toLowerCase());
  const idx=(...rxs:RegExp[])=>header.findIndex(h=>rxs.some(rx=>rx.test(h)));
  const districtI=idx(/^district$/i,/district.*name/i,/lea.*name/i);
  const superI=idx(/^superintendent$/i,/superintendent.*name/i);
  const firstI=idx(/superintendent.*first/i,/first.*superintendent/i);
  const lastI=idx(/superintendent.*last/i,/last.*superintendent/i);
  const emailI=idx(/superintendent.*e-?mail/i,/e-?mail.*superintendent/i);
  const phoneI=idx(/^phone$/i,/district.*phone/i,/office.*phone/i);
  if(districtI<0 || (superI<0 && (firstI<0 || lastI<0))) throw new Error(`Utah USBE CSV headers unresolved; headers=${header.join("|")}`);
  const contacts:Contact[]=[];
  for(const line of lines.slice(1)){
    const row=parse(line); const district=clean(row[districtI]);
    let fullName=superI>=0?person(row[superI]):"";
    if(!fullName && firstI>=0 && lastI>=0) fullName=person(`${clean(row[firstI])} ${clean(row[lastI])}`);
    const rawEmail=emailI>=0?clean(row[emailI]):""; const e=validEmail(rawEmail)?rawEmail:""; const phone=phoneI>=0?clean(row[phoneI]):"";
    if(!district||!fullName||(!e&&!phone)||/^(vacant|n\/a|none|unknown|tbd)$/i.test(fullName)) continue;
    contacts.push({district,fullName,email:e,phone});
  }
  const unique=new Map<string,Contact>(); for(const c of contacts){const k=districtKey(c.district);if(k&&!unique.has(k))unique.set(k,c);}
  if(unique.size<20) throw new Error(`Utah USBE CSV confidence guard: only ${unique.size} reachable superintendent records parsed; headers=${header.join("|")}`);
  return {contacts:[...unique.values()],exportUrl,diagnostics:{htmlBytes:html.length,csvRows:lines.length,headers:header,parsed:unique.size}};
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const counts=async()=> (await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const before=await counts();
  const available=Number((await sql.query(`select count(*)::int n from raven_state_contacts where state_code='UT' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'')<>$1`,[CHECKED]) as any[])[0]?.n||0);
  if(available===0){const after=await counts();const summary={ok:true,state:"UT",source:INDEX,skippedFetch:true,districtsNewlyAttempted:0,matched:0,filled:0,unmatched:0,remainingUnattempted:0,exhaustedCurrentSource:true,before,after,net:{total:0,verified:0,candidate:0,missing:0,rejected:0}};console.log("RAVEN_UT_AUTHORITATIVE",summary);return NextResponse.json(summary);}
  let parsed:{contacts:Contact[];exportUrl:string;diagnostics:any};
  try{parsed=await fetchUtah();}catch(error){const blocker=error instanceof Error?error.message:String(error);console.error("RAVEN_UT_AUTHORITATIVE_FETCH",blocker);return NextResponse.json({ok:false,state:"UT",source:INDEX,blocker,before},{status:502});}
  const slots=await sql.query(`select c.id::text,c.county,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='UT' and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' and coalesce(c.evidence_note,'')<>$1 order by coalesce(c.updated_at,c.created_at) asc,c.id asc limit $2`,[CHECKED,BATCH_SIZE]) as any[];
  let matched=0,filled=0,unmatched=0;
  for(const s of slots){const contact=parsed.contacts.find(r=>sameDistrict(s,r));if(contact){matched++;const u=await sql.query(`update raven_state_contacts set full_name=$2,title='Superintendent',email=nullif($3,''),phone=nullif($4,''),source_url=$5,verification_status='candidate',evidence_note='Utah superintendent and reachable contact published in the official Utah State Board of Education statewide district directory CSV export; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[s.id,contact.fullName,contact.email,contact.phone,parsed.exportUrl]) as any[];filled+=u.length;}else{unmatched++;await sql.query(`update raven_state_contacts set evidence_note=$2,updated_at=now() where id=$1 and verification_status='missing'`,[s.id,CHECKED]);}}
  const remaining=Number((await sql.query(`select count(*)::int n from raven_state_contacts where state_code='UT' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'')<>$1`,[CHECKED]) as any[])[0]?.n||0);
  const after=await counts();
  const summary={ok:true,state:"UT",source:parsed.exportUrl,fetched:parsed.contacts.length,districtsNewlyAttempted:slots.length,matched,filled,unmatched,remainingUnattempted:remaining,exhaustedCurrentSource:remaining===0,diagnostics:parsed.diagnostics,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_UT_AUTHORITATIVE",summary);return NextResponse.json(summary);
}
