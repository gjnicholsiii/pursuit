import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://www.fldoe.org/accountability/data-sys/school-dis-data/superintendents.stml";

type Contact = { district:string; fullName:string; title:string; email:string; phone:string|null };
type Slot = { id:string; canonical_name:string };

function decode(s:string){return s.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/&ndash;|&mdash;/gi,"-").replace(/&#8211;|&#8212;/g,"-");}
function textLines(html:string){
  const text=decode(html).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?\s*>/gi,"\n").replace(/<\/(p|div|li|h[1-6]|tr|td|section|article|a)>/gi,"\n").replace(/<[^>]+>/g," ");
  return text.split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
}
function cleanDistrict(v:string){return v.replace(/^\*+/,"").trim();}
function parse(html:string):Contact[]{
  const lines=textLines(html); const out:Contact[]=[];
  for(let i=0;i<lines.length;i++){
    const em=lines[i].match(/^E-mail:\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i); if(!em) continue;
    let sup=-1; for(let j=i-1;j>=Math.max(0,i-9);j--){if(/\b(?:interim\s+)?superintendent\b/i.test(lines[j])){sup=j;break;}}
    if(sup<1) continue;
    const nm=lines[sup].match(/^(.+?),\s*((?:Interim\s+)?Superintendent)\b/i); if(!nm) continue;
    let district=""; for(let j=sup-1;j>=Math.max(0,sup-3);j--){const x=cleanDistrict(lines[j]); if(x && !/^(Florida Public School Superintendents|Superintendents)$/i.test(x)){district=x;break;}}
    if(!district) continue;
    let phone:null|string=null; for(let j=sup+1;j<i;j++){const pm=lines[j].match(/^Supt\.\s*Phone:\s*(.+)$/i); if(pm){phone=pm[1].trim();break;}}
    out.push({district,fullName:nm[1].trim(),title:nm[2].trim(),email:em[1],phone});
  }
  return Array.from(new Map(out.map(c=>[`${c.district.toLowerCase()}|${c.email.toLowerCase()}`,c])).values());
}
function norm(v:string){return (v||"").toLowerCase().replace(/\b(public|schools?|school district|county|district|city|board of education)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function matchSlot(c:Contact,slots:Slot[]){
  const d=norm(c.district); if(!d) return null;
  const hits=slots.filter(s=>{const n=norm(s.canonical_name); return n===d || n.startsWith(d+" ") || n.endsWith(" "+d) || n.split(" ").includes(d);});
  return hits.length===1?hits[0]:null;
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth; const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const slots=await sql.query(`select c.id::text,a.canonical_name from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code='FL' and c.scope='district' and c.verification_status='missing' and c.role_key='superintendent'`) as Slot[];
  if(!slots.length) return NextResponse.json({ok:true,state:"FL",source:SOURCE,skippedFetch:true,districtsNewlyAttempted:0,filled:0,remainingUnattempted:0,before,after:before,net:{total:0,verified:0,candidate:0,missing:0,rejected:0}});
  const res=await fetch(SOURCE,{headers:{"user-agent":"Mozilla/5.0 Raven/1.0"},cache:"no-store"}); if(!res.ok) return NextResponse.json({ok:false,state:"FL",error:`FLDOE ${res.status}`},{status:502});
  const contacts=parse(await res.text()); if(contacts.length<50) return NextResponse.json({ok:false,state:"FL",error:"FLDOE parse returned too few superintendents",parsed:contacts.length},{status:502});
  let filled=0; const touched=new Set<string>(); const unmatched:string[]=[];
  for(const c of contacts){const slot=matchSlot(c,slots); if(!slot){unmatched.push(c.district);continue;} const rows=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,verification_status='candidate',evidence_note='Current superintendent contact published by the Florida Department of Education statewide superintendent directory.',updated_at=now() where id=$1 and role_key='superintendent' and verification_status='missing' returning id`,[slot.id,c.fullName,c.title,c.email,c.phone,SOURCE]) as any[]; if(rows.length){filled+=rows.length;touched.add(slot.canonical_name);}}
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const remaining=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='FL' and scope='district' and role_key='superintendent' and verification_status='missing'`) as any[])[0].n;
  const summary={ok:true,state:"FL",source:SOURCE,parsedSuperintendents:contacts.length,districtsNewlyAttempted:touched.size,filled,unmatched:unmatched.length,remainingUnattempted:remaining,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}}; console.log("RAVEN_FL_AUTHORITATIVE",summary); return NextResponse.json(summary);
}
