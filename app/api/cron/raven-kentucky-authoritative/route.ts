import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const KDE_DIRECTORY = "https://openhouse.education.ky.gov/Superintendents";
const KDE_DISTRICT = "https://openhouse.education.ky.gov/Home/District/";
const CHECKED = "Authoritative Kentucky KDE Open House district leadership/contact page checked for this missing role; no explicitly published matching reachable contact found.";
const BATCH_SIZE = 25;

type District = { code:string; district:string; phone:string; url:string };
type Contact = { fullName:string; title:string; email:string; phone:string; sourceUrl:string };
type Slot = { id:string; agency_id:string; county:string|null; canonical_name:string|null; role_key:string };

function clean(v:any){ return String(v ?? "").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function validEmail(v:string){ return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(clean(v)); }
function key(v:any){ return clean(v).toLowerCase().replace(/&/g," and ").replace(/\b(public|community|consolidated|independent|school|schools|district|county|city)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim(); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,""); }
function roleFor(title:string){
  if(/assistant|associate|deputy.*superintendent|assistant superintendent/i.test(title)) return "assistant_superintendent";
  if(/chief information|information technology|technology director|director.*technology|chief technology|technology coordinator|network administrator/i.test(title)) return "it_director";
  if(/security director|director.*security|school safety|safety coordinator|chief.*security|police chief|law enforcement/i.test(title)) return "security_director";
  if(/school district superintendent|^superintendent$/i.test(title)) return "superintendent";
  return "";
}

async function fetchHtml(url:string,timeoutMs=15000){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(url,{cache:"no-store",redirect:"follow",signal:controller.signal,headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/9.1; authoritative-public-directory)",accept:"text/html,application/xhtml+xml"}});
    if(!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return {url:res.url||url,html:await res.text()};
  } finally { clearTimeout(timer); }
}

async function districts():Promise<District[]>{
  const {html}=await fetchHtml(KDE_DIRECTORY);
  const $=cheerio.load(html); const out:District[]=[];
  $("tr").each((_,tr)=>{
    const cells=$(tr).find("th,td").map((__,td)=>clean($(td).text())).get();
    if(cells.length<5 || !/^\d{3,4}$/.test(cells[0]||"")) return;
    const code=cells[0], district=cells[1];
    const phone=cells.find(x=>/\(?\d{3}\)?[^\d]*\d{3}[^\d]*\d{4}/.test(x))||"";
    if(district) out.push({code,district,phone,url:`${KDE_DISTRICT}${Number(code)}`});
  });
  const dedup=[...new Map(out.map(x=>[key(x.district),x])).values()];
  if(dedup.length<150) throw new Error(`Kentucky KDE directory parsed only ${dedup.length} districts; refusing durable queue advancement`);
  return dedup;
}

function matchDistrict(slot:Slot,list:District[]){
  const ak=key(slot.canonical_name), ck=key(slot.county);
  return list.find(d=>{ const dk=key(d.district); return dk && (dk===ak||dk===ck||(ak&&ak.includes(dk))||(dk&&ak&&dk.includes(ak))); })||null;
}

function emailsFrom(el:any,$:cheerio.CheerioAPI){
  const found:string[]=[];
  $(el).find("a[href^='mailto:']").each((_,a)=>{const e=clean(($(a).attr("href")||"").replace(/^mailto:/i,"").split("?")[0]);if(validEmail(e))found.push(e);});
  $(el).find("img[alt]").each((_,img)=>{const a=clean($(img).attr("alt"));if(validEmail(a))found.push(a);});
  const text=clean($(el).text()); for(const e of text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[]) if(validEmail(e)) found.push(e);
  return [...new Set(found)];
}

function contacts(html:string,sourceUrl:string,defaultPhone:string):Contact[]{
  const $=cheerio.load(html); const out:Contact[]=[];
  $("tr").each((_,tr)=>{
    const cells=$(tr).find("th,td").toArray(); if(cells.length<2)return;
    const texts=cells.map(td=>clean($(td).text())); const title=texts[0]||""; const role=roleFor(title); if(!role)return;
    const fullName=person(texts[1]||""); if(!fullName)return;
    const es=emailsFrom(tr,$); const phone=(clean($(tr).text()).match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/)||[])[0]||defaultPhone;
    if(es[0]||phone) out.push({fullName,title,email:es[0]||"",phone,sourceUrl});
  });
  return out;
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth; const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  let list:District[]=[];
  try{ list=await districts(); }catch(err){const blocker=err instanceof Error?err.message:String(err);console.error("RAVEN_KY_AUTHORITATIVE_FETCH",blocker);return NextResponse.json({ok:false,state:"KY",blocker,before},{status:502});}
  const slots=await sql.query(`select c.id::text,c.agency_id::text,c.county,c.role_key,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='KY' and c.scope='district' and c.verification_status='missing' and c.role_key in ('superintendent','assistant_superintendent','it_director','security_director') and coalesce(c.evidence_note,'') <> $1 order by coalesce(c.updated_at,c.created_at) asc,c.id asc limit $2`,[CHECKED,BATCH_SIZE]) as Slot[];
  const pageCache=new Map<string,Contact[]>(); let matched=0,filled=0,unmatched=0; const districtsAttempted=new Set<string>();
  for(const s of slots){
    const d=matchDistrict(s,list); if(d)districtsAttempted.add(d.code);
    let cs:Contact[]=[];
    if(d){ if(pageCache.has(d.code))cs=pageCache.get(d.code)!; else { try{const page=await fetchHtml(d.url,12000);cs=contacts(page.html,page.url,d.phone);}catch{cs=[];} pageCache.set(d.code,cs); } }
    const c=cs.find(x=>roleFor(x.title)===s.role_key);
    if(c){ matched++; const u=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=nullif($4,''),phone=nullif($5,''),source_url=$6,verification_status='candidate',evidence_note='Contact identity and reachable details published by the Kentucky Department of Education Open House district directory; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[s.id,c.fullName,c.title,c.email,c.phone,c.sourceUrl]) as any[]; filled+=u.length; }
    else{unmatched++;await sql.query(`update raven_state_contacts set evidence_note=$2,updated_at=now() where id=$1 and verification_status='missing'`,[s.id,CHECKED]);}
  }
  const remaining=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='KY' and scope='district' and verification_status='missing' and role_key in ('superintendent','assistant_superintendent','it_director','security_director') and coalesce(evidence_note,'') <> $1`,[CHECKED]) as any[])[0]?.n||0;
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const summary={ok:true,state:"KY",source:KDE_DIRECTORY,districtRoster:list.length,slotsNewlyAttempted:slots.length,districtsNewlyAttempted:districtsAttempted.size,matched,filled,unmatched,remainingUnattempted:remaining,exhaustedCurrentSource:remaining===0,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_KY_AUTHORITATIVE",summary); return NextResponse.json(summary);
}
