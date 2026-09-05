import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://adedata.arkansas.gov/SPD/Home/districts";

type Contact = { district:string; lea:string; fullName:string; email:string|null; phone:string|null };
type Slot = { id:string; agency_id:string; canonical_name:string; verification_status:string };

function decode(s:string){return s.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/<br\s*\/?\s*>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();}
function parse(html:string):Contact[]{
  const out:Contact[]=[];
  const h3=Array.from(html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi));
  for(let i=0;i<h3.length;i++){
    const head=decode(h3[i][1]);
    const m=head.match(/^(.*?)\s+(\d{7})$/);
    if(!m) continue;
    const district=m[1].trim(); const lea=m[2];
    const start=(h3[i].index||0)+h3[i][0].length; const end=i+1<h3.length?(h3[i+1].index||html.length):html.length;
    const block=html.slice(start,end);
    const text=decode(block.replace(/<\/(div|p|li|td|tr)>/gi,"\n"));
    const sup=text.match(/Superintendent:\s*([^\n]+?)(?=\s*Superintendent Email:|\s*Website:|$)/i)?.[1]?.trim();
    const email=text.match(/Superintendent Email:\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1]?.trim()||null;
    if(!sup) continue;
    let phone:string|null=null;
    const staffSuper=block.match(/Staff:[\s\S]{0,1500}?Title:[\s\S]{0,400}?Superintendent[\s\S]{0,500}?Phone:[\s\S]{0,120}?([0-9]{3}[-.)\s][0-9]{3}[-\s][0-9]{4}(?:\s*x\s*\d+)?)/i);
    if(staffSuper) phone=staffSuper[1].replace(/\s+/g," ").trim();
    out.push({district,lea,fullName:sup,email,phone});
  }
  return out;
}
function norm(v:string){return (v||"").toLowerCase().replace(/\bpublic charter schools\b/g," ").replace(/\bpublic schools\b/g," ").replace(/\bschool district\b/g," ").replace(/\bschools\b/g," ").replace(/\bschool\b/g," ").replace(/\bdistrict\b/g," ").replace(/\bcounty\b/g," county ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function match(c:Contact, slots:Slot[]){
  const n=norm(c.district); const exact=slots.filter(s=>norm(s.canonical_name)===n); if(exact.length===1)return exact[0];
  const compact=n.replace(/\s+/g,""); const near=slots.filter(s=>{const x=norm(s.canonical_name).replace(/\s+/g,"");return x===compact||(x.length>5&&compact.length>5&&(x.includes(compact)||compact.includes(x)));});
  return near.length===1?near[0]:null;
}
async function counts(sql:ReturnType<typeof getSql>){return (await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth; const sql=getSql(); const before=await counts(sql);
  const beforeState=(await sql.query(`select count(*) filter(where verification_status='missing')::int missing from raven_state_contacts where state_code='AR' and role_key='superintendent'`) as any[])[0].missing;
  const res=await fetch(SOURCE,{headers:{"user-agent":"Mozilla/5.0 Raven/1.0"},cache:"no-store"});
  if(!res.ok)return NextResponse.json({ok:false,state:"AR",error:`Arkansas SPD ${res.status}`,before,beforeStateMissing:beforeState},{status:502});
  const contacts=parse(await res.text());
  if(contacts.length<180)return NextResponse.json({ok:false,state:"AR",error:"Statewide roster guard: too few superintendent records",parsed:contacts.length,before,beforeStateMissing:beforeState},{status:502});
  const slots=await sql.query(`select c.id::text,c.agency_id::text,a.canonical_name,c.verification_status from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code='AR' and c.scope='district' and c.role_key='superintendent'`) as Slot[];
  let matched=0,filled=0,peopleWritten=0; const touched=new Set<string>(); const unmatched:string[]=[];
  for(const c of contacts){
    const s=match(c,slots); if(!s){unmatched.push(c.district);continue;} matched++; touched.add(s.agency_id);
    await sql.query(`insert into raven_people(agency_id,full_name,title,role_family,email,phone,source_url,source_type,confidence,last_verified_at,updated_at) values($1,$2,'Superintendent','Executive',$3,$4,$5,'state_education_directory',98,now(),now()) on conflict(agency_id,full_name,title) do update set email=excluded.email,phone=excluded.phone,source_url=excluded.source_url,source_type=excluded.source_type,confidence=greatest(raven_people.confidence,excluded.confidence),last_verified_at=now(),updated_at=now()`,[s.agency_id,c.fullName,c.email,c.phone,SOURCE]); peopleWritten++;
    const r=await sql.query(`update raven_state_contacts set full_name=$2,title='Superintendent',email=$3,phone=$4,source_url=$5,verification_status='candidate',evidence_note='Current superintendent published by the Arkansas Department of Education School Personnel Directory for the current school year; email copied exactly when published.',updated_at=now() where id=$1 and verification_status in ('missing','rejected') returning id`,[s.id,c.fullName,c.email,c.phone,SOURCE]) as any[]; filled+=r.length;
  }
  const after=await counts(sql); const afterState=(await sql.query(`select count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='AR' and role_key='superintendent'`) as any[])[0];
  return NextResponse.json({ok:true,state:'AR',role:'superintendent',source:SOURCE,parsedSuperintendents:contacts.length,districtsProcessedInBulk:touched.size,matched,unmatchedSourceRecords:unmatched.length,unmatchedSample:unmatched.slice(0,20),peopleWritten,filled,beforeStateMissing:beforeState,afterState,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}});
}
