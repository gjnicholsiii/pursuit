import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://www.gssaweb.org/superintendents/";

type Contact = { fullName:string; title:string; email:string };
type Slot = { id:string; canonical_name:string };

const DOMAIN_DISTRICT: Record<string,string> = {
  "atlanta.k12.ga.us":"Atlanta Public Schools",
  "bcraiders.com":"Bacon County",
  "bcsdk12.net":"Bibb County",
  "bcssk12.org":"Butts County",
  "metter.org":"Candler County",
  "charlton.k12.ga.us":"Charlton County",
  "chattco.org":"Chattahoochee County",
  "glschools.org":"Chickamauga City",
  "ccboe.net":"Columbia County",
  "cowetaschools.net":"Coweta County",
  "dcssga.org":"Douglas County",
  "dcsirish.com":"Dublin City",
  "fcboe.org":"Fayette County",
  "gcssk12.net":"Gainesville City",
  "gcbe.org":"Gordon County",
  "grady.k12.ga.us":"Grady County",
  "gscs.org":"Griffin-Spalding County",
  "hallco.org":"Hall County",
  "hcbe.net":"Houston County",
  "jcss.us":"Jackson County",
  "jchs.com":"Jenkins County",
  "lcboe.net":"Laurens County",
  "lee.k12.ga.us":"Lee County",
  "liberty.k12.ga.us":"Liberty County",
  "lcboe.us":"Lincoln County",
  "mcssga.org":"Meriwether County",
  "mcschools.org":"Monroe County",
  "sowegak12.org":"Randolph County",
  "sccpss.com":"Savannah-Chatham County",
  "tcjackets.net":"Thomas County",
  "tcitys.org":"Thomasville City",
  "ucschools.org":"Union County"
};

function decode(s:string){
  return s.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/&ndash;|&mdash;/gi,"-").replace(/&#8211;|&#8212;/g,"-");
}
function textLines(html:string){
  const text=decode(html)
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<br\s*\/?\s*>/gi,"\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|td|section|article)>/gi,"\n")
    .replace(/<[^>]+>/g," ");
  return text.split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
}
function parseGssa(html:string):Contact[]{
  const lines=textLines(html);
  const out:Contact[]=[];
  const emailRe=/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
  for(let i=0;i<lines.length;i++){
    if(!emailRe.test(lines[i])) continue;
    let fullName="";
    for(let j=i-1;j>=Math.max(0,i-5);j--){
      const x=lines[j];
      if(emailRe.test(x)||/^(image|menu|home)$/i.test(x)||/^\+?[\d(). -]{7,}$/.test(x)) continue;
      fullName=x; break;
    }
    let title="";
    for(let j=i+1;j<=Math.min(lines.length-1,i+6);j++){
      if(/superi+n?tendent/i.test(lines[j])){ title=lines[j]; break; }
      if(emailRe.test(lines[j])) break;
    }
    if(fullName && title && /superi+n?tendent/i.test(title)) out.push({fullName,title,email:lines[i]});
  }
  return Array.from(new Map(out.map(c=>[c.email.toLowerCase(),c])).values());
}
function compact(v:string){return (v||"").toLowerCase().replace(/[^a-z0-9]/g,"");}
function districtBases(v:string){
  let x=v.toLowerCase()
    .replace(/^city schools of\s+/,"")
    .replace(/\b(public|charter|school|schools|system|district|county|city)\b/g," ")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
  const words=x.split(" ").filter(w=>w.length>=4 && !["state","specialty","academy","education"].includes(w));
  const joined=compact(x);
  return Array.from(new Set([joined,...words.map(compact)].filter(x=>x.length>=4)));
}
function matchSlot(contact:Contact,slots:Slot[]){
  const rawDomain=(contact.email.split("@")[1]||"").toLowerCase();
  const explicit=DOMAIN_DISTRICT[rawDomain];
  if(explicit){
    const exact=slots.filter(s=>s.canonical_name===explicit);
    if(exact.length===1) return exact[0];
  }
  const domain=compact(rawDomain);
  const hits=slots.filter(s=>districtBases(s.canonical_name).some(b=>domain.includes(b)));
  return hits.length===1 ? hits[0] : null;
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const before=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];

  const res=await fetch(SOURCE,{headers:{"user-agent":"Mozilla/5.0 Raven/1.0"},cache:"no-store"});
  if(!res.ok) return NextResponse.json({ok:false,state:"GA",error:`GSSA ${res.status}`},{status:502});
  const html=await res.text();
  const contacts=parseGssa(html);
  if(contacts.length<100) return NextResponse.json({ok:false,state:"GA",error:"GSSA parse returned too few superintendents",parsed:contacts.length},{status:502});

  const slots=await sql.query(`select c.id::text,a.canonical_name from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code='GA' and c.scope='district' and c.verification_status='missing' and c.role_key='superintendent'`) as Slot[];
  let attempted=0,matched=0,filled=0;
  const touched=new Set<string>();
  const unmatched:string[]=[];
  for(const contact of contacts){
    const slot=matchSlot(contact,slots);
    if(!slot){ unmatched.push(contact.email); continue; }
    attempted++; matched++; touched.add(slot.canonical_name);
    const rows=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=null,source_url=$5,verification_status='candidate',evidence_note='Current superintendent and direct email published by Georgia School Superintendents Association; district matched from the published district email domain.',updated_at=now() where id=$1 and role_key='superintendent' and verification_status='missing' returning id`,[slot.id,contact.fullName,contact.title,contact.email,SOURCE]) as any[];
    filled+=rows.length;
  }
  const after=(await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const summary={ok:true,state:"GA",role:"superintendent",source:SOURCE,parsedSuperintendents:contacts.length,districtsNewlyAttempted:touched.size,slotsNewlyAttempted:attempted,matched,filled,unmatchedSourceRecords:unmatched.length,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_GSSA_FULL",summary);
  return NextResponse.json(summary);
}
