import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Contact = { district:string; fullName:string; title:string; email:string; phone:string };
type Source = { state:string; url:string; fetch:()=>Promise<Contact[]> };

const FL = "https://cdn.fldoe.org/accountability/data-sys/school-dis-data/superintendents.stml";
const NE = "https://educdirsrc.education.ne.gov/QuickDisplay.aspx?code=pda&sort=name";

function clean(v:string){ return v.replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function email(v:string){ return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(v); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,""); }
function districtKey(v:string){
  return clean(v).toLowerCase().replace(/&/g," and ")
    .replace(/\b(public|community|consolidated|independent|county|city|school|schools|district|isd|csd|usd)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}

async function getHtml(url:string){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),20000);
  try{
    const r=await fetch(url,{cache:"no-store",redirect:"follow",signal:c.signal,headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/5.0; authoritative-state-roster)",accept:"text/html,application/xhtml+xml"}});
    if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text();
  } finally { clearTimeout(t); }
}

async function florida(){
  const $=cheerio.load(await getHtml(FL)); const lines=$("body").text().split(/\r?\n/).map(clean).filter(Boolean); const out:Contact[]=[];
  for(let i=1;i<lines.length;i++){
    if(!/\b(?:Interim\s+)?Superintendent\b/i.test(lines[i]) || /superintendents? of florida|school superintendents/i.test(lines[i])) continue;
    const comma=lines[i].indexOf(","); if(comma<2) continue;
    const fullName=person(lines[i].slice(0,comma)); const title=clean(lines[i].slice(comma+1)); const district=clean(lines[i-1]).replace(/^\*+|\*+$/g,"");
    let e="",p="";
    for(let j=i+1;j<Math.min(lines.length,i+10);j++){
      const em=lines[j].match(/(?:E-?mail|Email)\s*:\s*([^\s]+@[^\s]+)/i); if(em)e=em[1].replace(/[;,]+$/,"");
      const ph=lines[j].match(/Supt\.\s*Phone\s*:\s*(.+)$/i); if(ph)p=clean(ph[1]);
    }
    if(e&&!email(e))e=""; if(district&&fullName&&(e||p))out.push({district,fullName,title:title||"Superintendent",email:e,phone:p});
  }
  return [...new Map(out.map(x=>[districtKey(x.district),x])).values()];
}

async function nebraska(){
  const $=cheerio.load(await getHtml(NE)); const out:Contact[]=[];
  $("tr").each((_,el)=>{
    const c=$(el).find("th,td").map((__,x)=>clean($(x).text())).get(); const ai=c.findIndex(x=>/^\d{2}-\d{4}-\d{3}$/.test(x));
    if(ai<1||ai+1>=c.length)return; const fullName=person(c[ai-1]); const district=clean(c[ai+1]); const e=c.find(email)||""; const p=c.find(x=>/^\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}$/.test(x))||"";
    if(fullName&&district&&(e||p)&&!/administrator/i.test(fullName))out.push({district,fullName,title:"Superintendent",email:e,phone:p});
  });
  return [...new Map(out.map(x=>[districtKey(x.district),x])).values()];
}

const SOURCES:Source[]=[{state:"FL",url:FL,fetch:florida},{state:"NE",url:NE,fetch:nebraska}];

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth; const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const results:any[]=[];
  for(const source of SOURCES){
    let roster:Contact[]=[];
    try{ roster=await source.fetch(); }catch(err){ results.push({state:source.state,source:source.url,error:err instanceof Error?err.message:String(err),fetched:0,matched:0,filled:0}); continue; }
    const slots=await sql.query(`select c.id::text,c.county,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code=$1 and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing'`,[source.state]) as any[];
    const byKey=new Map(roster.map(r=>[districtKey(r.district),r])); let matched=0,filled=0;
    for(const s of slots){
      const ak=districtKey(s.canonical_name||""); const ck=districtKey(s.county||""); let r=byKey.get(ak)||byKey.get(ck);
      if(!r) r=roster.find(x=>{const rk=districtKey(x.district);return rk.length>2&&((ak&&ak===rk)||(ck&&ck===rk)||(ak&&ak.includes(rk))||(rk&&rk.includes(ak)));});
      if(!r)continue; matched++;
      const u=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=nullif($4,''),phone=nullif($5,''),source_url=$6,verification_status='candidate',evidence_note='Reachable contact ingested directly from authoritative statewide education directory; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[s.id,r.fullName,r.title,r.email,r.phone,source.url]) as any[];
      filled+=u.length;
    }
    results.push({state:source.state,source:source.url,fetched:roster.length,missingSlotsExamined:slots.length,matched,filled});
  }
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const summary={ok:true,mode:"statewide-authoritative-only",before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected},sources:results};
  console.log("RAVEN_AUTHORITATIVE",summary); return NextResponse.json(summary);
}
