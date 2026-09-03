import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INDEX = "https://web.ped.nm.gov/bureaus/constituent-services/school-directory/";
const CHECKED = "Authoritative NMPED district index and official district superintendent pages checked; no reachable published superintendent contact found on this pass.";
const BATCH_SIZE = 25;

type DistrictLink = { district:string; url:string };
type Contact = { fullName:string; email:string; phone:string; sourceUrl:string };

function clean(v:any){ return String(v ?? "").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function validEmail(v:string){ return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(clean(v)); }
function key(v:string){ return clean(v).toLowerCase().replace(/&/g," and ").replace(/\b(public|community|consolidated|independent|municipal|school|schools|district|charter|academy|cons|county|city)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim(); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,"").replace(/\b(superintendent(?: of schools)?|interim superintendent)\b.*$/i,"").trim(); }
function absolutize(base:string,href:string){ try{return new URL(href,base).toString();}catch{return "";} }

async function fetchHtml(url:string, timeoutMs=15000){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(url,{cache:"no-store",redirect:"follow",signal:controller.signal,headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/8.1; authoritative-public-directory)",accept:"text/html,application/xhtml+xml"}});
    if(!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return {url:res.url||url,html:await res.text()};
  } finally { clearTimeout(timer); }
}

async function districtLinks():Promise<DistrictLink[]>{
  const {html}=await fetchHtml(INDEX);
  const $=cheerio.load(html); const out:DistrictLink[]=[];
  $("a[href]").each((_,a)=>{
    const district=clean($(a).text()); const href=clean($(a).attr("href"));
    if(!district || !href || !/(schools?|district)/i.test(district)) return;
    const url=absolutize(INDEX,href);
    if(!url || /ped\.state\.nm\.us|web\.ped\.nm\.gov|docs\.google\.com/i.test(new URL(url).hostname)) return;
    out.push({district,url});
  });
  const map=new Map<string,DistrictLink>(); for(const d of out){ const k=key(d.district); if(k&&!map.has(k))map.set(k,d); }
  if(map.size<50) throw new Error(`NMPED district index parsed only ${map.size} official district links; refusing to advance durable queue`);
  return [...map.values()];
}

function matchDistrict(slot:any,links:DistrictLink[]){
  const ak=key(slot.canonical_name||""), ck=key(slot.county||"");
  return links.find(d=>{const dk=key(d.district); return dk && (dk===ak || dk===ck || (ak&&ak.includes(dk)) || (dk&&ak&&dk.includes(ak)));}) || null;
}

function contactFromPage(html:string,sourceUrl:string):Contact|null{
  const $=cheerio.load(html);
  const containers=$("article,main,section,div,li,tr,p").toArray();
  for(const el of containers){
    const text=clean($(el).text());
    if(!/\bsuperintendent\b/i.test(text) || /(assistant|associate|deputy)\s+superintendent/i.test(text)) continue;
    const emails:string[]=[];
    $(el).find("a[href^='mailto:']").each((_,a)=>{const e=clean(($(a).attr("href")||"").replace(/^mailto:/i,"").split("?")[0]); if(validEmail(e))emails.push(e);});
    const textEmails=text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[];
    for(const e of textEmails) if(validEmail(e)) emails.push(e);
    const email=[...new Set(emails)][0]||""; if(!email) continue;
    const phone=(text.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/)||[])[0]||"";
    const pieces=text.split(/\s{2,}|\||•|\n/).map(clean).filter(Boolean);
    let fullName="";
    for(const p of pieces){
      if(/superintendent/i.test(p)){
        const before=person(p.replace(/\b(interim\s+)?superintendent(?: of schools)?\b/i," "));
        const nameMatch=before.match(/(?:Dr\.?\s+|Mr\.?\s+|Mrs\.?\s+|Ms\.?\s+)?([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,3})/);
        if(nameMatch){fullName=person(nameMatch[0]);break;}
      }
    }
    if(!fullName){
      const raw=text.replace(email," ");
      const m=raw.match(/(?:Dr\.?\s+|Mr\.?\s+|Mrs\.?\s+|Ms\.?\s+)?([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,3})\s*[,\-–|:]?\s*(?:Interim\s+)?Superintendent\b/);
      if(m) fullName=person(m[0]);
    }
    if(fullName && fullName.length>=4 && fullName.length<=80) return {fullName,email,phone,sourceUrl};
  }
  return null;
}

async function findOfficialContact(homeUrl:string):Promise<Contact|null>{
  try{
    const home=await fetchHtml(homeUrl,12000); const $=cheerio.load(home.html);
    const candidates:string[]=[home.url];
    $("a[href]").each((_,a)=>{
      const label=clean($(a).text()); const href=clean($(a).attr("href"));
      if(!/(superintendent|administration|leadership|district staff|central office|district office)/i.test(`${label} ${href}`)) return;
      const u=absolutize(home.url,href); if(u && new URL(u).hostname===new URL(home.url).hostname) candidates.push(u);
    });
    for(const url of [...new Set(candidates)].slice(0,4)){
      try{ const page=url===home.url?home:await fetchHtml(url,10000); const c=contactFromPage(page.html,page.url); if(c)return c; }catch{}
    }
  }catch{}
  return null;
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const available=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='NM' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'') <> $1`,[CHECKED]) as any[])[0]?.n||0;
  if(available===0){ const summary={ok:true,state:"NM",source:INDEX,skippedFetch:true,districtsNewlyAttempted:0,matched:0,filled:0,unmatched:0,remainingUnattempted:0,exhaustedCurrentSource:true,before,after:before,net:{total:0,verified:0,candidate:0,missing:0,rejected:0}}; console.log("RAVEN_NM_AUTHORITATIVE",summary); return NextResponse.json(summary); }
  let links:DistrictLink[]=[];
  try{ links=await districtLinks(); }catch(err){const blocker=err instanceof Error?err.message:String(err); console.error("RAVEN_NM_AUTHORITATIVE_FETCH",blocker); return NextResponse.json({ok:false,state:"NM",blocker,before},{status:502});}
  const slots=await sql.query(`select c.id::text,c.county,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='NM' and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' and coalesce(c.evidence_note,'') <> $1 order by coalesce(c.updated_at,c.created_at) asc,c.id asc limit $2`,[CHECKED,BATCH_SIZE]) as any[];
  let matched=0,filled=0,unmatched=0;
  for(const s of slots){
    const d=matchDistrict(s,links); const c=d?await findOfficialContact(d.url):null;
    if(c){ matched++; const u=await sql.query(`update raven_state_contacts set full_name=$2,title='Superintendent',email=$3,phone=nullif($4,''),source_url=$5,verification_status='candidate',evidence_note='Superintendent and email published on the official school district website linked by the New Mexico Public Education Department; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[s.id,c.fullName,c.email,c.phone,c.sourceUrl]) as any[]; filled+=u.length; }
    else { unmatched++; await sql.query(`update raven_state_contacts set evidence_note=$2,updated_at=now() where id=$1 and verification_status='missing'`,[s.id,CHECKED]); }
  }
  const remaining=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='NM' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'') <> $1`,[CHECKED]) as any[])[0]?.n||0;
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const summary={ok:true,state:"NM",source:INDEX,officialDistrictLinks:links.length,districtsNewlyAttempted:slots.length,matched,filled,unmatched,remainingUnattempted:remaining,exhaustedCurrentSource:remaining===0,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_NM_AUTHORITATIVE",summary); return NextResponse.json(summary);
}
