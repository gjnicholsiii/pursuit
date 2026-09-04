import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INDEX = "https://www.isbe.net/pages/data-analysis-directories.aspx";
const SOURCE = "https://www.isbe.net/_layouts/Download.aspx?SourceUrl=%2FDocuments%2Fdir_ed_entities.xls";
const CHECKED = "Authoritative Illinois ISBE Directory of Educational Entities v2 checked; no matching published reachable district administrator for this district in this source.";
const BATCH_SIZE = 250;

type Contact = { district:string; fullName:string; phone:string; email:string };

function clean(v:any){ return String(v ?? "").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function person(v:string){ return clean(v).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i,""); }
function validEmail(v:string){ return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(clean(v)); }
function districtKey(v:string){
  return clean(v).toLowerCase().replace(/&/g," and ")
    .replace(/\b(public|community|consolidated|independent|county|city|school|schools|district|unit|union|unified|elementary|high|cusd|csd|ccsd|sd|uhsd)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function col(headers:string[], patterns:RegExp[]){ return headers.findIndex(h=>patterns.some(rx=>rx.test(clean(h)))); }

async function illinois():Promise<{contacts:Contact[];diagnostics:any}> {
  const res=await fetch(SOURCE,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/7.3; authoritative-state-roster)",accept:"application/vnd.ms-excel,application/octet-stream,*/*"}});
  if(!res.ok) throw new Error(`Illinois ISBE directory HTTP ${res.status}`);
  const buf=Buffer.from(await res.arrayBuffer());
  const wb=XLSX.read(buf,{type:"buffer"});
  const contacts:Contact[]=[];
  const diagnostics:any={sheets:wb.SheetNames,examined:[]};

  for(const sheetName of wb.SheetNames){
    if(!/(public.*(sch|dist)|dist.*sch)/i.test(sheetName)) continue;
    const matrix=XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName],{header:1,defval:"",raw:false}) as any[][];
    const headerIndex=matrix.findIndex(row=>{
      const cells=row.map(clean);
      return cells.some(c=>/^FacilityName$/i.test(c)) && cells.some(c=>/^Administrator$/i.test(c)) && cells.some(c=>/^RecType$/i.test(c));
    });
    if(headerIndex<0){ diagnostics.examined.push({sheetName,headerIndex,preview:matrix.slice(0,5).map(r=>r.map(clean).filter(Boolean).slice(0,15))}); continue; }

    const headers=matrix[headerIndex].map(clean);
    const districtI=col(headers,[/^FacilityName$/i,/^entity\s*name$/i,/^district\s*name$/i]);
    const adminI=col(headers,[/^Administrator$/i,/^superintendent$/i,/chief\s*administrator/i]);
    const phoneI=col(headers,[/^Telephone$/i,/^phone/i]);
    const emailI=col(headers,[/e-?mail/i]);
    const recTypeI=col(headers,[/^RecType$/i]);
    diagnostics.examined.push({sheetName,headerIndex,headers,districtI,adminI,phoneI,emailI,recTypeI});

    if(districtI<0 || adminI<0 || recTypeI<0 || phoneI<0) continue;
    for(const row of matrix.slice(headerIndex+1)){
      if(!/^Dist$/i.test(clean(row[recTypeI]))) continue;
      const district=clean(row[districtI]);
      const admin=person(clean(row[adminI]));
      const p=clean(row[phoneI]);
      const rawEmail=emailI>=0?clean(row[emailI]):"";
      const email=validEmail(rawEmail)?rawEmail:"";
      if(!district || !admin || (!p && !email)) continue;
      if(/^(vacant|n\/a|none|unknown)$/i.test(admin)) continue;
      contacts.push({district,fullName:admin,phone:p,email});
    }
  }
  const out=new Map<string,Contact>();
  for(const c of contacts){ const k=districtKey(c.district); if(k && !out.has(k)) out.set(k,c); }
  if(out.size===0){
    console.error("RAVEN_IL_WORKBOOK_DIAGNOSTICS",JSON.stringify(diagnostics));
    throw new Error(`Illinois ISBE workbook parsed zero reachable district administrators; diagnostics emitted`);
  }
  return {contacts:[...out.values()],diagnostics};
}

function sameDistrict(slot:any, contact:Contact){
  const dk=districtKey(contact.district), ak=districtKey(slot.canonical_name||""), ck=districtKey(slot.county||"");
  return !!dk && (ak===dk || ck===dk || (ak&&ak.includes(dk)) || (dk&&ak&&dk.includes(ak)));
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const available=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='IL' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'') <> $1`,[CHECKED]) as any[])[0]?.n||0;
  if(available===0){
    const summary={ok:true,state:"IL",source:INDEX,skippedFetch:true,districtsNewlyAttempted:0,matched:0,filled:0,unmatched:0,remainingUnattempted:0,exhaustedCurrentSource:true,before,after:before,net:{total:0,verified:0,candidate:0,missing:0,rejected:0}};
    console.log("RAVEN_IL_AUTHORITATIVE",summary); return NextResponse.json(summary);
  }
  let roster:Contact[]=[]; let parserDiagnostics:any=null;
  try{ const parsed=await illinois(); roster=parsed.contacts; parserDiagnostics=parsed.diagnostics; }
  catch(err){ const blocker=err instanceof Error?err.message:String(err); console.error("RAVEN_IL_AUTHORITATIVE_FETCH",blocker); return NextResponse.json({ok:false,state:"IL",blocker,before},{status:502}); }
  const slots=await sql.query(`select c.id::text,c.county,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='IL' and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' and coalesce(c.evidence_note,'') <> $1 order by coalesce(c.updated_at,c.created_at) asc,c.id asc limit $2`,[CHECKED,BATCH_SIZE]) as any[];
  let matched=0,filled=0,unmatched=0;
  for(const s of slots){
    const contact=roster.find(r=>sameDistrict(s,r));
    if(contact){
      matched++;
      const u=await sql.query(`update raven_state_contacts set full_name=$2,title='Superintendent',email=nullif($3,''),phone=nullif($4,''),source_url=$5,verification_status='candidate',evidence_note='Illinois district administrator and reachable contact published in the official ISBE Directory of Educational Entities, updated nightly; awaiting strict live revalidation.',updated_at=now() where id=$1 and verification_status='missing' returning id`,[s.id,contact.fullName,contact.email,contact.phone,SOURCE]) as any[];
      filled+=u.length;
    } else {
      unmatched++;
      await sql.query(`update raven_state_contacts set evidence_note=$2,updated_at=now() where id=$1 and verification_status='missing'`,[s.id,CHECKED]);
    }
  }
  const remaining=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='IL' and scope='district' and role_key='superintendent' and verification_status='missing' and coalesce(evidence_note,'') <> $1`,[CHECKED]) as any[])[0]?.n||0;
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const summary={ok:true,state:"IL",source:SOURCE,fetched:roster.length,districtsNewlyAttempted:slots.length,matched,filled,unmatched,remainingUnattempted:remaining,exhaustedCurrentSource:remaining===0,parserSheets:parserDiagnostics?.sheets||[],before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_IL_AUTHORITATIVE",summary); return NextResponse.json(summary);
}
