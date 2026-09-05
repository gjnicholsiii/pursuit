import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE = "https://datacenter.ride.ri.gov/Directory/LEADetail?orgid=";

type Counts = { total:number; verified:number; candidate:number; missing:number; rejected:number };
type Slot = { id:string; agency_id:string; canonical_name:string; nces_id:string|null };
type Parsed = { orgid:number; leaName:string; ncesId:string; fullName:string; title:string; sourceUrl:string };

async function counts(sql:ReturnType<typeof getSql>):Promise<Counts>{
  const rows = await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[];
  return rows[0] as Counts;
}

function decode(s:string){return s.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/&#8211;|&#8212;|&ndash;|&mdash;/gi,"-");}
function lines(html:string){
  return decode(html)
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<br\s*\/?\s*>/gi,"\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|td|section|article|dt|dd)>/gi,"\n")
    .replace(/<[^>]+>/g," ")
    .split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
}
function norm(v:string){return (v||"").toLowerCase().replace(/\b(public|school|schools|district|regional|charter|academy|the)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function parse(html:string,orgid:number):Parsed|null{
  const ls=lines(html);
  const ncesLine=ls.find(x=>/^NCES Code:/i.test(x));
  if(!ncesLine)return null;
  const ncesId=(ncesLine.match(/NCES Code:\s*([0-9]+)/i)||[])[1]||"";
  if(!ncesId)return null;
  const ncesIndex=ls.indexOf(ncesLine);
  let leaName="";
  for(let i=ncesIndex-1;i>=0&&i>=ncesIndex-8;i--){
    const x=ls[i];
    if(/^(LEA Information|LEA Code:|LEA Type:|Grade Span:|Status:|Location)/i.test(x))continue;
    if(x.length>1){leaName=x;break;}
  }
  const candidates:{fullName:string;title:string}[]=[];
  for(let i=0;i<ls.length;i++){
    if(!/^Role\(s\):\s*Superintendent\b/i.test(ls[i]))continue;
    let title="",fullName="";
    for(let j=i-1;j>=0&&j>=i-6;j--){
      if(!title && /^Title:\s*/i.test(ls[j])){title=ls[j].replace(/^Title:\s*/i,"").trim();continue;}
      if(title && !/^Title:/i.test(ls[j]) && !/^Contact\(s\)/i.test(ls[j]) && !/^Role\(s\):/i.test(ls[j])){fullName=ls[j].trim();break;}
    }
    if(fullName && title && /superintendent/i.test(title))candidates.push({fullName,title});
  }
  if(!candidates.length)return null;
  candidates.sort((a,b)=>{
    const score=(x:{title:string})=>/^superintendent$/i.test(x.title)?3:/^district superintendent$/i.test(x.title)?3:/interim/i.test(x.title)?1:2;
    return score(b)-score(a);
  });
  const best=candidates[0];
  return {orgid,leaName,ncesId,fullName:best.fullName,title:best.title,sourceUrl:`${BASE}${orgid}`};
}

async function fetchOne(orgid:number):Promise<Parsed|null>{
  const url=`${BASE}${orgid}`;
  try{
    const res=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 Raven/1.0"},cache:"no-store"});
    if(!res.ok)return null;
    return parse(await res.text(),orgid);
  }catch{return null;}
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req);if(auth)return auth;
  const sql=getSql();
  const before=await counts(sql);
  const slots=await sql.query(`select c.id::text,c.agency_id::text,a.canonical_name,a.nces_id from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code='RI' and c.scope='district' and c.role_key='superintendent' and c.verification_status in ('missing','rejected')`) as Slot[];
  const missingBefore=slots.length;
  if(!slots.length){return NextResponse.json({ok:true,state:"RI",source:BASE,missingBefore:0,missingAfter:0,districtsProcessedInBulk:0,filled:0,before,after:before,net:{total:0,verified:0,candidate:0,missing:0,rejected:0},exhausted:true});}

  const parsed:Parsed[]=[];
  for(let start=1;start<=220;start+=20){
    const batch=await Promise.all(Array.from({length:20},(_,k)=>fetchOne(start+k)));
    for(const r of batch)if(r)parsed.push(r);
  }
  const byNces=new Map(parsed.map(r=>[r.ncesId,r]));
  let filled=0;const attempted=new Set<string>();const unmatched:string[]=[];
  for(const slot of slots){
    let hit=slot.nces_id?byNces.get(slot.nces_id):undefined;
    if(!hit){
      const n=norm(slot.canonical_name);
      const matches=parsed.filter(r=>norm(r.leaName)===n || (norm(r.leaName).length>=4 && (n.includes(norm(r.leaName))||norm(r.leaName).includes(n))));
      if(matches.length===1)hit=matches[0];
    }
    attempted.add(slot.agency_id);
    if(!hit){unmatched.push(slot.canonical_name);continue;}
    const rows=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=null,phone=null,source_url=$4,verification_status='candidate',evidence_note='Current superintendent published by the Rhode Island Department of Education authoritative LEA directory; matched by NCES LEA ID where available. No email inferred.',updated_at=now() where id=$1 and role_key='superintendent' and verification_status in ('missing','rejected') returning id`,[slot.id,hit.fullName,hit.title,hit.sourceUrl]) as any[];
    filled+=rows.length;
  }
  const after=await counts(sql);
  const remain=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='RI' and scope='district' and role_key='superintendent' and verification_status='missing'`) as any[])[0]?.n||0;
  const summary={ok:true,state:"RI",source:BASE,authoritativePagesParsed:parsed.length,missingBefore,missingAfter:remain,districtsProcessedInBulk:attempted.size,filled,unmatched:unmatched.slice(0,25),before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_RI_AUTHORITATIVE",summary);
  return NextResponse.json(summary);
}
