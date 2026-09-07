import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic="force-dynamic";
export const maxDuration=300;

const SOURCE="https://apps.schools.nc.gov/public/f?p=125:840::::RP:P840_LEA_CODE,P840_FISCAL_YEAR:%,";

type Contact={psu:string;district:string;fullName:string;email:string|null;phone:string|null};
type Slot={id:string;canonical_name:string|null;county:string|null};

function clean(v:any){return String(v??"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();}
function norm(v:any){return clean(v).toLowerCase().replace(/&/g," and ").replace(/\b(public|school|schools|district|county|city|local)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function person(v:string){return clean(v).replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss)\s+/i,"").trim();}
function phone(v:string){return (clean(v).match(/\(?\d{3}\)?[- .]\d{3}[- .]\d{4}/)||[])[0]||null;}
function email(v:string){return (clean(v).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0]||null;}

async function roster(){
 const r=await fetch(SOURCE,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/12.0; authoritative-state-roster)",accept:"text/html,application/xhtml+xml"}});
 if(!r.ok)throw new Error(`EDDIE report HTTP ${r.status}`);
 const html=await r.text();const $=cheerio.load(html);const out:Contact[]=[];
 $("table tr").each((_,tr)=>{
   const c=$(tr).find("th,td").map((__,td)=>clean($(td).text())).get();
   if(c.length<10)return;
   if(clean(c[0]).toLowerCase()!=="regular local school district")return;
   const psu=clean(c[1]);const district=clean(c[2]);const fullName=person(c[3]);
   if(!/^\d{3}$/.test(psu)||!district||fullName.split(/\s+/).length<2)return;
   out.push({psu,district,fullName,email:email(c[4]),phone:phone(c[10]||c[9]||"")});
 });
 const dedup=[...new Map(out.map(x=>[x.psu,x])).values()];
 if(dedup.length<100)throw new Error(`EDDIE parser confidence guard: only ${dedup.length} regular-district superintendent records parsed; no writes performed`);
 return dedup;
}
function match(c:Contact,slots:Slot[]){const k=norm(c.district);let a=slots.filter(s=>norm(s.canonical_name)===k);if(a.length===1)return a[0];a=slots.filter(s=>norm(s.county)===k);if(a.length===1)return a[0];a=slots.filter(s=>{const x=norm(s.canonical_name);return x&&k&&(x.includes(k)||k.includes(x));});return a.length===1?a[0]:null;}

export async function GET(req:NextRequest){
 const auth=requireInternalAuth(req);if(auth)return auth;const sql=getSql();
 const before=(await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='NC' and scope='district' and role_key='superintendent'`)as any[])[0];
 let list:Contact[]=[];try{list=await roster();}catch(e){return NextResponse.json({ok:false,state:'NC',source:SOURCE,blocker:e instanceof Error?e.message:String(e),before},{status:502});}
 const slots=await sql.query(`select c.id::text,c.county,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='NC' and c.scope='district' and c.role_key='superintendent'`)as Slot[];
 let matched=0,written=0;const unmatched:string[]=[];
 for(const c of list){const s=match(c,slots);if(!s){unmatched.push(`${c.psu} ${c.district}`);continue;}matched++;const u=await sql.query(`update raven_state_contacts set full_name=$2,title='Superintendent',email=$3,phone=$4,source_url=$5,verification_status='verified',verified_at=now(),evidence_note='Current superintendent contact published in North Carolina DPI EDDIE for a PSU explicitly classified as Regular local school district.',updated_at=now() where id=$1 and verification_status in ('missing','candidate','rejected') returning id`,[s.id,c.fullName,c.email,c.phone,SOURCE])as any[];written+=u.length;}
 const after=(await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='NC' and scope='district' and role_key='superintendent'`)as any[])[0];
 return NextResponse.json({ok:true,state:'NC',source:SOURCE,parsed:list.length,matched,written,unmatchedSourceRecords:unmatched.length,unmatchedSample:unmatched.slice(0,20),before,after,verifiedAdded:Number(after.verified)-Number(before.verified)});
}
