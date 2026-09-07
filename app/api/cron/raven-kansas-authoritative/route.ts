import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";
import { extractText, getDocumentProxy } from "unpdf";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://www.ksde.gov/Portals/0/Directories/2025-26%20Kansas%20Educational%20Directory.pdf?ver=2026-01-26-121048-680";

type Contact={usd:string;district:string;fullName:string;phone:string|null};
type Slot={id:string;canonical_name:string|null;county:string|null};

function clean(v:any){return String(v??"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();}
function norm(v:any){return clean(v).toLowerCase().replace(/&/g," and ").replace(/\busd\s*0*(\d{3})\b/g," $1 ").replace(/\b(public|community|consolidated|independent|school|schools|district|county|city|unified)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function usdNumber(v:any){return (clean(v).match(/\bUSD\s*0*(\d{3})\b/i)||clean(v).match(/\b0*(\d{3})\b/))?.[1]||"";}
function plausibleName(v:string){const x=clean(v).replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss)\s+/i,"");if(x.length<4||x.length>80||/superintendent|board|president|county|phone|fax|street|road|box|department/i.test(x))return "";const p=x.split(/\s+/);if(p.length<2||p.length>5)return "";return p.every(t=>/^[A-Za-z][A-Za-z.'-]*$/.test(t))?x:"";}
function phone(v:string){return (clean(v).match(/(?:Phone:\s*)?(\(?\d{3}\)?[- .]\d{3}[- .]\d{4})/i)||[])[1]||"";}

async function roster():Promise<Contact[]>{
  const res=await fetch(SOURCE,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/10.0; authoritative-state-roster)",accept:"application/pdf,*/*"}});
  if(!res.ok)throw new Error(`KSDE directory HTTP ${res.status}`);
  const pdf=await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
  const out:any=await extractText(pdf,{mergePages:true});
  const text=typeof out?.text==="string"?out.text:Array.isArray(out?.text)?out.text.join("\n"):String(out||"");
  const lines=text.split(/\r?\n/).map(clean).filter(Boolean);
  const contacts:Contact[]=[];
  const heading=/^(.+?)\s+USD\s+(\d{3})$/i;
  for(let i=0;i<lines.length;i++){
    const h=lines[i].match(heading); if(!h)continue;
    const district=clean(h[1]); const usd=h[2];
    let superAt=-1;
    for(let j=i+1;j<Math.min(lines.length,i+24);j++){
      if(j>i+1&&heading.test(lines[j]))break;
      if(/^SUPERINTENDENT$/i.test(lines[j])){superAt=j;break;}
    }
    if(superAt<0)continue;
    let fullName=""; let p:string|null=null;
    for(let j=superAt+1;j<Math.min(lines.length,superAt+14);j++){
      if(/^BOARD PRESIDENT$/i.test(lines[j])||heading.test(lines[j]))break;
      if(!fullName)fullName=plausibleName(lines[j]);
      const ph=phone(lines[j]); if(ph)p=ph;
    }
    if(fullName)contacts.push({usd,district,fullName,phone:p});
  }
  const dedup=[...new Map(contacts.map(c=>[c.usd,c])).values()];
  if(dedup.length<200)throw new Error(`KSDE parser confidence guard: only ${dedup.length} superintendent records parsed; no writes performed`);
  return dedup;
}

function matchSlot(c:Contact,slots:Slot[]){
  const byUsd=slots.filter(s=>usdNumber(s.canonical_name)===c.usd);
  if(byUsd.length===1)return byUsd[0];
  const dk=norm(c.district);
  const exact=slots.filter(s=>norm(s.canonical_name)===dk);
  if(exact.length===1)return exact[0];
  const near=slots.filter(s=>{const x=norm(s.canonical_name);return x&&dk&&(x.includes(dk)||dk.includes(x));});
  return near.length===1?near[0]:null;
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req);if(auth)return auth;
  const sql=getSql();
  const before=(await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='KS' and scope='district' and role_key='superintendent'`) as any[])[0];
  let list:Contact[]=[];try{list=await roster();}catch(e){return NextResponse.json({ok:false,state:'KS',source:SOURCE,blocker:e instanceof Error?e.message:String(e),before},{status:502});}
  const slots=await sql.query(`select c.id::text,c.county,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='KS' and c.scope='district' and c.role_key='superintendent'`) as Slot[];
  let matched=0,written=0;const unmatched:string[]=[];
  for(const c of list){
    const s=matchSlot(c,slots);if(!s){unmatched.push(`${c.district} USD ${c.usd}`);continue;}matched++;
    const rows=await sql.query(`update raven_state_contacts set full_name=$2,title='Superintendent',email=null,phone=$3,source_url=$4,verification_status='verified',verified_at=now(),evidence_note='Current superintendent and district phone published in the official 2025-2026 Kansas State Department of Education statewide educational directory.',updated_at=now() where id=$1 and verification_status in ('missing','candidate','rejected') returning id`,[s.id,c.fullName,c.phone,SOURCE]) as any[];
    written+=rows.length;
  }
  const after=(await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='KS' and scope='district' and role_key='superintendent'`) as any[])[0];
  return NextResponse.json({ok:true,state:'KS',source:SOURCE,parsed:list.length,matched,written,unmatchedSourceRecords:unmatched.length,unmatchedSample:unmatched.slice(0,20),before,after,verifiedAdded:Number(after.verified)-Number(before.verified)});
}
