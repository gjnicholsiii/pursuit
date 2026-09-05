import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://oklahoma.gov/content/dam/ok/en/osde/documents/resources/state-directory/FY26EOYOnlineDirectoryDistrictList.xlsx";

type Slot = { id:string; agency_id:string; canonical_name:string; verification_status:string };
type Contact = { district:string; fullName:string; title:string; email:string|null; phone:string|null };

function clean(v:any){ return String(v ?? "").replace(/\s+/g," ").trim(); }
function norm(v:string){
  return clean(v).toLowerCase()
    .replace(/\bpublic schools?\b/g," ")
    .replace(/\bschool district\b/g," ")
    .replace(/\bdistrict\b/g," ")
    .replace(/\bschools?\b/g," ")
    .replace(/\bindependent\b/g," ")
    .replace(/\bisd\b/g," ")
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ").trim();
}
function keyBy(headers:string[], patterns:RegExp[]){ return headers.find(h => patterns.some(p => p.test(h))) || null; }
function findSlot(district:string, slots:Slot[]){
  const n = norm(district);
  const exact = slots.filter(s => norm(s.canonical_name) === n);
  if (exact.length === 1) return exact[0];
  const compact = n.replace(/\s+/g,"");
  const near = slots.filter(s => {
    const x = norm(s.canonical_name).replace(/\s+/g,"");
    return x === compact || (x.length >= 5 && compact.length >= 5 && (x.includes(compact) || compact.includes(x)));
  });
  return near.length === 1 ? near[0] : null;
}
async function counts(sql:ReturnType<typeof getSql>){
  return (await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
}

export async function GET(req:NextRequest){
  const auth = requireInternalAuth(req); if(auth) return auth;
  const sql = getSql();
  const before = await counts(sql);
  const beforeState = (await sql.query(`select count(*) filter(where role_key='superintendent' and verification_status='missing')::int missing from raven_state_contacts where state_code='OK'`) as any[])[0].missing;

  const res = await fetch(SOURCE,{headers:{"user-agent":"Mozilla/5.0 Raven/1.0"},cache:"no-store"});
  if(!res.ok) return NextResponse.json({ok:false,state:"OK",source:SOURCE,error:`OSDE XLSX ${res.status}`,before,beforeStateMissing:beforeState},{status:502});
  const buf = Buffer.from(await res.arrayBuffer());
  let wb:XLSX.WorkBook;
  try { wb = XLSX.read(buf,{type:"buffer"}); }
  catch(e){ return NextResponse.json({ok:false,state:"OK",source:SOURCE,error:`XLSX parse failed: ${String(e)}`,bytes:buf.length,before,beforeStateMissing:beforeState},{status:502}); }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string,any>>(sheet,{defval:"",raw:false});
  if(rows.length < 400) return NextResponse.json({ok:false,state:"OK",source:SOURCE,error:"Statewide roster guard: fewer than 400 district rows",rows:rows.length,sheets:wb.SheetNames,before,beforeStateMissing:beforeState},{status:502});

  const headers = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const lower = headers.map(h=>h.toLowerCase());
  const districtKey = keyBy(lower,[/^district name$/, /district.*name/, /^district$/]);
  const superNameKey = keyBy(lower,[/^superintendent$/, /superintendent.*name/, /name.*superintendent/]);
  const superFirstKey = keyBy(lower,[/superintendent.*first/, /first.*superintendent/]);
  const superLastKey = keyBy(lower,[/superintendent.*last/, /last.*superintendent/]);
  const superEmailKey = keyBy(lower,[/superintendent.*e-?mail/, /e-?mail.*superintendent/]);
  const superPhoneKey = keyBy(lower,[/superintendent.*phone/, /phone.*superintendent/]);
  const original = (lk:string|null) => lk ? headers[lower.indexOf(lk)] : null;
  const dk=original(districtKey), nk=original(superNameKey), fk=original(superFirstKey), lk=original(superLastKey), ek=original(superEmailKey), pk=original(superPhoneKey);
  if(!dk || (!nk && !(fk && lk))) return NextResponse.json({ok:false,state:"OK",source:SOURCE,error:"Could not identify district/superintendent columns",rows:rows.length,headers,before,beforeStateMissing:beforeState},{status:502});

  const contacts:Contact[]=[];
  for(const r of rows){
    const district=clean(r[dk]); if(!district) continue;
    const fullName=nk ? clean(r[nk]) : `${clean(r[fk!])} ${clean(r[lk!])}`.replace(/\s+/g," ").trim();
    if(!fullName || /^n\/?a$/i.test(fullName)) continue;
    const email=ek ? clean(r[ek]) : "";
    const phone=pk ? clean(r[pk]) : "";
    contacts.push({district,fullName,title:"Superintendent",email:email&&/@/.test(email)?email:null,phone:phone||null});
  }
  if(contacts.length < 350) return NextResponse.json({ok:false,state:"OK",source:SOURCE,error:"Statewide roster guard: fewer than 350 superintendent records",rows:rows.length,parsedSuperintendents:contacts.length,headers,selected:{district:dk,name:nk,first:fk,last:lk,email:ek,phone:pk},before,beforeStateMissing:beforeState},{status:502});

  const slots = await sql.query(`select c.id::text,c.agency_id::text,a.canonical_name,c.verification_status from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code='OK' and c.scope='district' and c.role_key='superintendent'`) as Slot[];
  let matched=0,filled=0,peopleWritten=0; const touched=new Set<string>(); const unmatched:string[]=[];
  for(const c of contacts){
    const s=findSlot(c.district,slots); if(!s){unmatched.push(c.district); continue;}
    matched++; touched.add(s.agency_id);
    await sql.query(`insert into raven_people(agency_id,full_name,title,role_family,email,phone,source_url,source_type,confidence,last_verified_at,updated_at) values($1,$2,$3,'Executive',$4,$5,$6,'state_education_directory',95,now(),now()) on conflict(agency_id,full_name,title) do update set email=excluded.email,phone=excluded.phone,source_url=excluded.source_url,source_type=excluded.source_type,confidence=greatest(raven_people.confidence,excluded.confidence),last_verified_at=now(),updated_at=now()`,[s.agency_id,c.fullName,c.title,c.email,c.phone,SOURCE]);
    peopleWritten++;
    const rr=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,verification_status='candidate',evidence_note='Current superintendent published in the Oklahoma State Department of Education statewide District Directory; contact fields copied exactly when published.',updated_at=now() where id=$1 and verification_status in ('missing','rejected') returning id`,[s.id,c.fullName,c.title,c.email,c.phone,SOURCE]) as any[];
    filled += rr.length;
  }
  const after=await counts(sql);
  const afterState=(await sql.query(`select count(*) filter(where role_key='superintendent' and verification_status='missing')::int missing,count(*) filter(where role_key='superintendent' and verification_status='candidate')::int candidate,count(*) filter(where role_key='superintendent' and verification_status='verified')::int verified,count(*) filter(where role_key='superintendent' and verification_status='rejected')::int rejected from raven_state_contacts where state_code='OK'`) as any[])[0];
  return NextResponse.json({ok:true,state:"OK",role:"superintendent",source:SOURCE,rows:rows.length,parsedSuperintendents:contacts.length,districtsProcessedInBulk:touched.size,matched,unmatchedSourceRecords:unmatched.length,unmatchedSample:unmatched.slice(0,25),peopleWritten,filled,beforeStateMissing:beforeState,afterState,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}});
}
