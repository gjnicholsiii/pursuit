import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";
import { extractText, getDocumentProxy } from "unpdf";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://www.alabamaachieves.org/wp-content/uploads/2025/01/COMM_20250106_DAPS-2025_V1.0.pdf";
const CHECKED = "ALSDE 2025 statewide directory checked; no matching superintendent line found for this Raven district.";

type Slot = { id:string; canonical_name:string };

type Contact = { fullName:string; phone:string };

function clean(v:string){ return (v||"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function key(v:string){ return clean(v).toLowerCase().replace(/&/g," and ").replace(/\b(public|charter|school|schools|system|district)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim(); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,"").replace(/\s+(Ed\.D\.|Ph\.D\.)$/i,""); }
function phoneFrom(line:string){ const m=line.match(/\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/); return m?m[0]:""; }

function findContact(pages:string[], district:string):Contact|null{
  const dk=key(district);
  if(!dk) return null;
  for(const page of pages){
    const lines=page.split(/\r?\n/).map(clean).filter(Boolean);
    for(let i=0;i<lines.length;i++){
      const lk=key(lines[i]);
      if(!lk || !(lk===dk || lk.includes(dk) || dk.includes(lk))) continue;
      for(let j=i;j<Math.min(lines.length,i+90);j++){
        const line=lines[j];
        if(/Secretary to the Superintendent|Asst Superintendent|Assistant Superintendent/i.test(line)) continue;
        const m=line.match(/^(.+?)\s+Superintendent\s+(\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4})\b/i);
        if(m){
          const fullName=person(m[1]);
          const phone=phoneFrom(m[2]);
          if(fullName && phone) return {fullName,phone};
        }
      }
    }
  }
  return null;
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const slots=await sql.query(`select c.id::text,a.canonical_name from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code='AL' and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' and coalesce(c.evidence_note,'')<>$1 order by a.canonical_name`,[CHECKED]) as Slot[];
  if(slots.length===0){
    const summary={ok:true,state:'AL',source:SOURCE,districtsNewlyAttempted:0,matched:0,filled:0,unmatched:0,remainingUnattempted:0,before,after:before,net:{total:0,verified:0,candidate:0,missing:0,rejected:0}};
    console.log('RAVEN_AL_AUTHORITATIVE',summary); return NextResponse.json(summary);
  }
  let pages:string[]=[];
  try{
    const res=await fetch(SOURCE,{cache:'no-store',redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; Pursuit-Raven/7.0; authoritative-state-roster)'}});
    if(!res.ok) throw new Error(`ALSDE PDF HTTP ${res.status}`);
    const pdf=await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
    const result=await extractText(pdf,{mergePages:false});
    pages=result.text as string[];
    if(pages.length<200) throw new Error(`ALSDE PDF extracted only ${pages.length} pages`);
  }catch(err){
    const blocker=err instanceof Error?err.message:String(err);
    console.error('RAVEN_AL_AUTHORITATIVE_FETCH',blocker);
    return NextResponse.json({ok:false,state:'AL',blocker,before},{status:502});
  }
  let matched=0,filled=0,unmatched=0;
  const touched:string[]=[];
  for(const slot of slots){
    const contact=findContact(pages,slot.canonical_name);
    if(contact){
      matched++; touched.push(slot.canonical_name);
      const rows=await sql.query(`update raven_state_contacts set full_name=$2,title='Superintendent',email=null,phone=$3,source_url=$4,verification_status='candidate',evidence_note='Superintendent and direct office phone published in the Alabama State Department of Education statewide public-school directory; awaiting live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[slot.id,contact.fullName,contact.phone,SOURCE]) as any[];
      filled+=rows.length;
    }else{
      unmatched++;
      await sql.query(`update raven_state_contacts set evidence_note=$2,updated_at=now() where id=$1 and verification_status='missing'`,[slot.id,CHECKED]);
    }
  }
  const remaining=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='AL' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'')<>$1`,[CHECKED]) as any[])[0]?.n||0;
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const summary={ok:true,state:'AL',source:SOURCE,districtsNewlyAttempted:slots.length,matched,filled,unmatched,remainingUnattempted:remaining,touched,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log('RAVEN_AL_AUTHORITATIVE',summary); return NextResponse.json(summary);
}
