import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";
import { extractText, getDocumentProxy } from "unpdf";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://www.alabamaachieves.org/wp-content/uploads/2025/01/COMM_20250106_DAPS-2025_V1.0.pdf";
const EVIDENCE = "Superintendent and direct office phone published in the Alabama State Department of Education statewide public-school directory; awaiting live revalidation.";
const CHECKED = "ALSDE 2025 statewide directory checked with page-local district matching; no matching superintendent found for this Raven district.";
const ASHS_SOURCE = "https://www.alhealthcarehs.org/about-us/administration-staff";
const ASHS_EVIDENCE = "Official Alabama School of Healthcare Sciences administration page lists Dr. James (Jimmy) Martin as President, the school's chief executive. No individual email published; none inferred.";

type Slot = { id:string; canonical_name:string; verification_status:string; evidence_note:string|null };
type Contact = { fullName:string; phone:string };

function clean(v:string){ return (v||"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function key(v:string){ return clean(v).toLowerCase().replace(/&/g," and ").replace(/\b(public|charter|school|schools|system|district)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim(); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,"").replace(/\s+(Ed\.D\.|Ph\.D\.)$/i,""); }
function systemHeading(line:string){
  const m=clean(line).match(/^\d{3}\s+[^A-Za-z0-9]*\s*(.+)$/);
  return m ? clean(m[1]) : "";
}
function contactFromBlock(lines:string[], start:number, end:number):Contact|null{
  let office=-1;
  for(let i=start;i<end;i++) if(/SUPERINTENDENT[’']?S OFFICE/i.test(lines[i])){ office=i; break; }
  if(office<0) return null;
  for(let i=office+1;i<Math.min(end,office+12);i++){
    const line=lines[i];
    if(/Secretary to the Superintendent|Asst Superintendent|Assistant Superintendent/i.test(line)) continue;
    const m=line.match(/^(.+?)\s+Superintendent\s+(\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4})\b/i);
    if(m){ const fullName=person(m[1]); if(fullName) return {fullName,phone:m[2]}; }
  }
  return null;
}
function findContact(pages:string[], district:string):Contact|null{
  const dk=key(district); if(!dk) return null;
  for(const page of pages.slice(35,262)){
    const lines=page.split(/\r?\n/).map(clean).filter(Boolean);
    for(let i=0;i<lines.length;i++){
      const heading=systemHeading(lines[i]);
      if(!heading || key(heading)!==dk) continue;
      let end=lines.length;
      for(let j=i+1;j<lines.length;j++) if(systemHeading(lines[j])){ end=j; break; }
      const c=contactFromBlock(lines,i,end); if(c) return c;
    }
  }
  return null;
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const slots=await sql.query(`select c.id::text,a.canonical_name,c.verification_status,c.evidence_note from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code='AL' and c.scope='district' and c.role_key='superintendent' and c.verification_status in ('missing','rejected') and (coalesce(c.evidence_note,'') <> $1 or a.canonical_name='Alabama School of Healthcare Sciences') order by a.canonical_name`,[CHECKED]) as Slot[];
  if(slots.length===0){ const summary={ok:true,state:'AL',source:SOURCE,districtsProcessed:0,matched:0,filledOrRepaired:0,unmatched:0,before,after:before}; console.log('RAVEN_AL_AUTHORITATIVE',summary); return NextResponse.json(summary); }

  let matched=0,filledOrRepaired=0,unmatched=0; const touched:string[]=[]; const pending:Slot[]=[];
  for(const slot of slots){
    if(slot.canonical_name==='Alabama School of Healthcare Sciences'){
      const rows=await sql.query(`update raven_state_contacts set full_name=$2,title='President',email=null,phone=null,source_url=$3,verification_status='candidate',evidence_note=$4,updated_at=now() where id=$1 and verification_status in ('missing','rejected') returning id`,[slot.id,'Dr. James (Jimmy) Martin',ASHS_SOURCE,ASHS_EVIDENCE]) as any[];
      if(rows.length){ matched++; filledOrRepaired+=rows.length; touched.push(slot.canonical_name); }
    }else pending.push(slot);
  }

  let pages:string[]=[];
  if(pending.length){
    try{
      const res=await fetch(SOURCE,{cache:'no-store',redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; Pursuit-Raven/8.0; authoritative-state-roster)'}});
      if(!res.ok) throw new Error(`ALSDE PDF HTTP ${res.status}`);
      const pdf=await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
      const result=await extractText(pdf,{mergePages:false}); pages=result.text as string[];
      if(pages.length<200) throw new Error(`ALSDE PDF extracted only ${pages.length} pages`);
    }catch(err){ const blocker=err instanceof Error?err.message:String(err); console.error('RAVEN_AL_AUTHORITATIVE_FETCH',blocker); return NextResponse.json({ok:false,state:'AL',blocker,before},{status:502}); }
  }

  for(const slot of pending){
    const contact=findContact(pages,slot.canonical_name);
    if(contact){
      matched++; touched.push(slot.canonical_name);
      const rows=await sql.query(`update raven_state_contacts set full_name=$2,title='Superintendent',email=null,phone=$3,source_url=$4,verification_status='candidate',evidence_note=$5,updated_at=now() where id=$1 returning id`,[slot.id,contact.fullName,contact.phone,SOURCE,EVIDENCE]) as any[];
      filledOrRepaired+=rows.length;
    }else{
      unmatched++;
      await sql.query(`update raven_state_contacts set evidence_note=$2,updated_at=now() where id=$1 and verification_status in ('missing','rejected')`,[slot.id,CHECKED]);
    }
  }
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const coverage=(await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='AL' and role_key='superintendent'`) as any[])[0];
  const summary={ok:true,state:'AL',source:SOURCE,districtsProcessed:slots.length,matched,filledOrRepaired,unmatched,coverage,touched,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log('RAVEN_AL_AUTHORITATIVE',summary); return NextResponse.json(summary);
}
