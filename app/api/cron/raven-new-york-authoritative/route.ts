import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";
import { extractText, getDocumentProxy } from "unpdf";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://www.p12.nysed.gov/irs/schoolDirectory/documents/SECTIONII.pdf";
const CHECKED = "Authoritative NYSED Directory of Public and Nonpublic Schools and Administrators checked; no matching published district administrator found for this superintendent slot.";
const BATCH_SIZE = 250;

type Contact = { district: string; fullName: string; phone: string };

function clean(v:string){ return (v||"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,""); }
function districtKey(v:string){ return clean(v).toLowerCase().replace(/&/g," and ").replace(/\b(public|community|consolidated|independent|county|city|school|schools|district|union|unified|central|elementary|high)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim(); }

async function roster():Promise<Contact[]> {
  const res = await fetch(SOURCE,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/6.0; authoritative-state-roster)",accept:"application/pdf,*/*"}});
  if(!res.ok) throw new Error(`NYSED SECTIONII HTTP ${res.status}`);
  const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
  const out:any = await extractText(pdf,{mergePages:true});
  const text = typeof out?.text === "string" ? out.text : Array.isArray(out?.text) ? out.text.join("\n") : String(out||"");
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const contacts:Contact[]=[];
  const districtRx=/\b(CSD|UFSD|UFSD|CENTRAL SCHOOL DISTRICT|CITY SCHOOL DISTRICT|SCHOOL DISTRICT)\b/i;
  const phoneRx=/(\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4})/;
  for(let i=0;i<lines.length;i++){
    const district=lines[i];
    if(!districtRx.test(district) || district.length>120) continue;
    const window=lines.slice(i+1,i+8);
    const nameLine=window.find(x=>/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+[A-Z][A-Za-z'\-.]+(?:\s+[A-Z][A-Za-z'\-.]+){1,4}$/.test(x));
    const phoneLine=window.find(x=>phoneRx.test(x));
    if(nameLine && phoneLine){
      const phone=phoneLine.match(phoneRx)?.[1]||"";
      contacts.push({district,fullName:person(nameLine),phone});
    }
  }
  const unique=[...new Map(contacts.map(x=>[districtKey(x.district),x])).values()];
  if(unique.length<100) throw new Error(`NYSED parser confidence guard: only ${unique.length} district administrator records parsed; no database writes performed`);
  return unique;
}

function sameDistrict(slot:any, c:Contact){
  const dk=districtKey(c.district), ak=districtKey(slot.canonical_name||""), ck=districtKey(slot.county||"");
  return !!dk && (ak===dk || ck===dk || (ak&&ak.includes(dk)) || (dk&&ak&&dk.includes(ak)));
}

async function counts(sql:ReturnType<typeof getSql>){
  return (await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql(); const before=await counts(sql);
  const available=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='NY' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'') <> $1`,[CHECKED]) as any[])[0]?.n||0;
  if(available===0){
    const summary={ok:true,state:"NY",source:SOURCE,skippedFetch:true,districtsNewlyAttempted:0,matched:0,filled:0,unmatched:0,remainingUnattempted:0,exhaustedCurrentSource:true,before,after:before,net:{total:0,verified:0,candidate:0,missing:0,rejected:0}};
    console.log("RAVEN_NY_AUTHORITATIVE",summary); return NextResponse.json(summary);
  }
  let r:Contact[]=[]; try{r=await roster();}catch(err){const blocker=err instanceof Error?err.message:String(err); console.error("RAVEN_NY_AUTHORITATIVE_FETCH",blocker); return NextResponse.json({ok:false,state:"NY",source:SOURCE,blocker,before},{status:502});}
  const slots=await sql.query(`select c.id::text,c.county,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='NY' and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' and coalesce(c.evidence_note,'') <> $1 order by coalesce(c.updated_at,c.created_at) asc,c.id asc limit $2`,[CHECKED,BATCH_SIZE]) as any[];
  let matched=0,filled=0,unmatched=0;
  for(const s of slots){
    const c=r.find(x=>sameDistrict(s,x));
    if(c){ matched++; const u=await sql.query(`update raven_state_contacts set full_name=$2,title='Superintendent',email=null,phone=$3,source_url=$4,verification_status='candidate',evidence_note='District administrator and district phone published in the current official NYSED Directory of Public and Nonpublic Schools and Administrators; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[s.id,c.fullName,c.phone,SOURCE]) as any[]; filled+=u.length; }
    else { unmatched++; await sql.query(`update raven_state_contacts set evidence_note=$2,updated_at=now() where id=$1 and verification_status='missing'`,[s.id,CHECKED]); }
  }
  const remaining=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='NY' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'') <> $1`,[CHECKED]) as any[])[0]?.n||0;
  const after=await counts(sql);
  const summary={ok:true,state:"NY",source:SOURCE,fetched:r.length,districtsNewlyAttempted:slots.length,matched,filled,unmatched,remainingUnattempted:remaining,exhaustedCurrentSource:remaining===0,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_NY_AUTHORITATIVE",summary); return NextResponse.json(summary);
}
