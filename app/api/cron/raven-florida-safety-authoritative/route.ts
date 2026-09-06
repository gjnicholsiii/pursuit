import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://origin.fldoe.org/schools/k-12-public-schools/sss/dist-mental-coor.stml";

type Contact = { district:string; fullName:string; email:string|null; phone:string|null };
type Slot = { id:string; canonical_name:string };

function decode(s:string){return s.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/&ndash;|&mdash;/gi,"-").replace(/&#8211;|&#8212;/g,"-");}
function textLines(html:string){
  const text=decode(html)
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<br\s*\/?\s*>/gi,"\n")
    .replace(/<\/[^>]+>/g,"\n")
    .replace(/<[^>]+>/g," ");
  return text.split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
}
function norm(v:string){return (v||"").toLowerCase().replace(/\b(public|schools?|school district|county|district|city|board of education)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function parse(html:string):Contact[]{
  const lines=textLines(html); const out:Contact[]=[];
  for(let i=0;i<lines.length;i++){
    if(!/^School Safety Specialist$/i.test(lines[i])) continue;
    const fullName=(lines[i+1]||"").trim();
    if(!fullName || /@/.test(fullName) || /^(Mental Health Coordinator|School Safety Specialist)$/i.test(fullName)) continue;
    let phone:string|null=null, email:string|null=null;
    for(let j=i+2;j<Math.min(lines.length,i+9);j++){
      if(!phone && /\d{3}[-.)\s]\d{3}[-\s]\d{4}/.test(lines[j])) phone=lines[j];
      const em=lines[j].match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i); if(em){email=em[0];break;}
      if(/^Mental Health Coordinator$/i.test(lines[j]) || /^School Safety Specialist$/i.test(lines[j])) break;
    }
    let district="";
    for(let j=i-1;j>=Math.max(0,i-20);j--){
      const x=lines[j].trim();
      if(!x || /^(Mental Health Coordinator|School Safety Specialist)$/i.test(x) || /@/.test(x) || /\d{3}[-.)\s]\d{3}/.test(x)) continue;
      if(/County$|School$|Schools$|LEA$|Charter$|Academy$|District$|FSDB$|FLVS$/i.test(x)){district=x;break;}
    }
    if(district) out.push({district,fullName,email,phone});
  }
  return Array.from(new Map(out.map(c=>[`${norm(c.district)}|${c.fullName.toLowerCase()}`,c])).values());
}
function matchSlot(c:Contact,slots:Slot[]){
  const d=norm(c.district); if(!d) return null;
  const aliases = d === "miami dade" ? ["miami dade","dade"] : d === "florida virtual" ? ["fl virtual","florida virtual"] : d === "florida school for the deaf and blind" ? ["deaf blind","florida school for the deaf and blind"] : [d];
  const hits=slots.filter(s=>{const n=norm(s.canonical_name); return aliases.some(a=>n===a || n.startsWith(a+" ") || n.endsWith(" "+a));});
  return hits.length===1?hits[0]:null;
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth; const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const slots=await sql.query(`select c.id::text,a.canonical_name from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code='FL' and c.scope='district' and c.verification_status='missing' and c.role_key='security_director'`) as Slot[];
  if(!slots.length) return NextResponse.json({ok:true,state:"FL",source:SOURCE,districtsNewlyAttempted:0,filled:0,remainingUnattempted:0,before,after:before,net:{total:0,verified:0,candidate:0,missing:0,rejected:0}});
  let html=""; let fetchError:string|null=null;
  try{const res=await fetch(SOURCE,{headers:{"user-agent":"Mozilla/5.0 Raven/1.0"},cache:"no-store"}); if(!res.ok) fetchError=`FLDOE ${res.status}`; else html=await res.text();}catch(e:any){fetchError=e?.message||"FLDOE fetch failed";}
  const contacts=html?parse(html):[];
  if(contacts.length<50){
    console.log("RAVEN_FL_SAFETY_PARSE_BLOCKED",{fetchError,htmlBytes:html.length,parsedSafetySpecialists:contacts.length,sample:contacts.slice(0,8)});
    return NextResponse.json({ok:false,state:"FL",source:SOURCE,fetchError,htmlBytes:html.length,parsedSafetySpecialists:contacts.length,sample:contacts.slice(0,8),error:"Authoritative FLDOE safety directory parser returned too few records; refusing partial promotion."},{status:502});
  }
  let filled=0; const touched=new Set<string>(); const unmatched:string[]=[];
  for(const c of contacts){
    const slot=matchSlot(c,slots); if(!slot){unmatched.push(c.district);continue;}
    const rows=await sql.query(`update raven_state_contacts set full_name=$2,title='School Safety Specialist',email=$3,phone=$4,source_url=$5,verification_status='candidate',evidence_note='Current district School Safety Specialist published by the Florida Department of Education statewide directory.',updated_at=now() where id=$1 and role_key='security_director' and verification_status='missing' returning id`,[slot.id,c.fullName,c.email,c.phone,SOURCE]) as any[];
    if(rows.length){filled+=rows.length;touched.add(slot.canonical_name);}
  }
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const remaining=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='FL' and scope='district' and role_key='security_director' and verification_status='missing'`) as any[])[0].n;
  const summary={ok:true,state:"FL",source:SOURCE,parsedSafetySpecialists:contacts.length,districtsNewlyAttempted:touched.size,filled,unmatched:unmatched.slice(0,20),remainingUnattempted:remaining,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_FL_SAFETY_AUTHORITATIVE",summary); return NextResponse.json(summary);
}
