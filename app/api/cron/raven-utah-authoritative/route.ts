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
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,"").replace(/\s*[-,]\s*(?:State\s+)?Superintendent.*$/i,"").trim(); }
function districtKey(v:string){
  return clean(v).toLowerCase().replace(/&/g," and ")
    .replace(/\b(public|community|consolidated|independent|county|city|school|schools|district|isd|csd|usd|charter|academy)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function sameDistrict(slot:any, contact:Contact){
  const dk=districtKey(contact.district), ak=districtKey(slot.canonical_name||""), ck=districtKey(slot.county||"");
  return !!dk && (ak===dk || ck===dk || (ak&&ak.includes(dk)) || (dk&&ak&&dk.includes(ak)));
}

function parseRosterPage(html:string):Contact[]{
  const $=cheerio.load(html);
  const tokens:string[]=[];

  // Apptegy/Thrillshare staff cards frequently concatenate child text when read
  // through an ancestor.  Read leaf text nodes in DOM order instead so the
  // published district -> superintendent -> email sequence is preserved.
  $("body").find("*").each((_,el)=>{
    const own=$(el).clone().children().remove().end().text();
    const t=clean(own);
    if(t && t.length<=180) tokens.push(t);
  });

  // The same staff data can also be present in hydration JSON. Add short
  // decoded string values as a fallback without trusting any inferred data.
  const decoded=html
    .replace(/\\u0026/g,"&").replace(/\\u0027/g,"'").replace(/\\u002D/gi,"-")
    .replace(/\\u003C/gi,"<").replace(/\\u003E/gi,">").replace(/\\\"/g,'"');
  const jsonStrings=decoded.match(/"([^"\\]{2,180})"/g)||[];
  for(const raw of jsonStrings){
    const t=clean(raw.slice(1,-1));
    if(t && (/Superintendent/i.test(t) || validEmail(t) || /\b(?:District|City|Summit|Sanpete)\b/i.test(t))) tokens.push(t);
  }

  const out:Contact[]=[];
  const seenEmail=new Set<string>();
  for(let i=0;i<tokens.length;i++){
    const title=tokens[i];
    const m=title.match(/^(.{2,90}?)\s*[-,]\s*(?:State\s+)?Superintendent\s*$/i);
    if(!m) continue;
    const fullName=person(m[1]);
    if(!fullName) continue;

    let district="";
    for(let j=i-1;j>=Math.max(0,i-8);j--){
      const t=tokens[j];
      if(/^(?:Alpine|Aspen Peaks|Beaver|Box Elder|Cache|Canyons|Carbon|Daggett|Davis|Duchesne|Emery|Garfield|Grand|Granite|Iron|Jordan|Juab|Kane|Lake Mountain|Logan|Millard|Morgan|Murray|Nebo|North Summit|North Sanpete|Ogden|Park City|Piute|Provo|Rich|Salt Lake|San Juan|Sevier|South Sanpete|South Summit|Timpanogos|Tintic|Tooele|Uintah|Wasatch|Washington|Wayne|Weber)(?:\s+(?:District|City))?$/i.test(t)) { district=t; break; }
      if(/\b(?:District|City|Summit|Sanpete)\b/i.test(t) && !/Superintendent|Association|Educational Services|Education Service Center|Development Center|State Board/i.test(t)){ district=t; break; }
    }
    if(!district) continue;

    let email="";
    let phone="";
    for(let j=i+1;j<=Math.min(tokens.length-1,i+8);j++){
      if(!email){
        const em=tokens[j].match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]||"";
        if(validEmail(em)) email=clean(em);
      }
      if(!phone){
        const ph=tokens[j].match(/(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/)?.[0]||"";
        if(ph) phone=clean(ph);
      }
      if(email) break;
    }
    if(!email || seenEmail.has(email.toLowerCase())) continue;
    seenEmail.add(email.toLowerCase());
    out.push({district:clean(district),fullName,email,phone});
  }
  return out;
}

async function fetchUtah():Promise<{contacts:Contact[]; diagnostics:any}>{
  const pages=[1,2,3];
  const contacts:Contact[]=[];
  const pageDiagnostics:any[]=[];
  for(const page of pages){
    const url=`${SOURCE}?page_no=${page}`;
    const res=await fetch(url,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/8.5; authoritative-superintendent-association)",accept:"text/html,application/xhtml+xml"}});
    if(!res.ok) throw new Error(`Utah USSA superintendent roster page ${page} HTTP ${res.status}`);
    const html=await res.text();
    const parsed=parseRosterPage(html);
    contacts.push(...parsed);
    pageDiagnostics.push({page,htmlBytes:html.length,parsed:parsed.length});
  }

  const unique=new Map<string,Contact>();
  for(const c of contacts){ const k=districtKey(c.district); if(k && !unique.has(k)) unique.set(k,c); }
  if(unique.size<35) throw new Error(`Utah USSA confidence guard: only ${unique.size} district superintendent records parsed across statewide roster pages; diagnostics=${JSON.stringify(pageDiagnostics)}`);
  return {contacts:[...unique.values()],diagnostics:{pages:pageDiagnostics,parsed:unique.size}};
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
