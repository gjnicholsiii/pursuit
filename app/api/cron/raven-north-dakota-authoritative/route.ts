import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";
import { parse } from "csv-parse/sync";

export const dynamic="force-dynamic";
export const maxDuration=300;
const SOURCE="https://insights.nd.gov/ShowFile?f=10090_90_csv_2025-2026";

type Contact={district:string;fullName:string;email:string|null;phone:string|null;id:string|null};
type Slot={id:string;canonical_name:string|null;county:string|null};
function clean(v:any){return String(v??"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();}
function norm(v:any){return clean(v).toLowerCase().replace(/&/g," and ").replace(/\b(public|school|schools|district|county|city)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function find(row:Record<string,any>,rx:RegExp){const k=Object.keys(row).find(x=>rx.test(clean(x)));return k?clean(row[k]):"";}
async function roster(){
 const r=await fetch(SOURCE,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/13.0; authoritative-state-roster)",accept:"text/csv,text/plain,*/*"}});
 if(!r.ok)throw new Error(`ND Insights dataset HTTP ${r.status}`);
 const text=await r.text();
 const rows=parse(text,{columns:true,skip_empty_lines:true,bom:true,relax_column_count:true,trim:true}) as Record<string,any>[];
 const out:Contact[]=[];
 for(const row of rows){
   const district=find(row,/^InstitutionName$/i)||find(row,/district.*name/i);
   const fullName=find(row,/SuperintendantName|SuperintendentName/i);
   if(!district||!fullName||fullName.split(/\s+/).length<2)continue;
   const email=find(row,/SuperintendantEmail|SuperintendentEmail/i);
   out.push({district,fullName,email:/@/.test(email)?email:null,phone:find(row,/^Phone$/i)||null,id:find(row,/DistrictInstitutionID/i)||null});
 }
 const dedup=[...new Map(out.map(x=>[x.id||norm(x.district),x])).values()];
 if(dedup.length<150)throw new Error(`ND Insights parser confidence guard: only ${dedup.length} superintendent records parsed; no writes performed`);
 return dedup;
}
function match(c:Contact,slots:Slot[]){const k=norm(c.district);let a=slots.filter(s=>norm(s.canonical_name)===k);if(a.length===1)return a[0];a=slots.filter(s=>{const x=norm(s.canonical_name);return x&&k&&(x.includes(k)||k.includes(x));});return a.length===1?a[0]:null;}
export async function GET(req:NextRequest){
 const auth=requireInternalAuth(req);if(auth)return auth;const sql=getSql();
 const before=(await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='ND' and scope='district' and role_key='superintendent'`)as any[])[0];
 let list:Contact[]=[];try{list=await roster();}catch(e){return NextResponse.json({ok:false,state:'ND',source:SOURCE,blocker:e instanceof Error?e.message:String(e),before},{status:502});}
 const slots=await sql.query(`select c.id::text,c.county,a.canonical_name from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='ND' and c.scope='district' and c.role_key='superintendent'`)as Slot[];
 let matched=0,written=0;const unmatched:string[]=[];
 for(const c of list){const s=match(c,slots);if(!s){unmatched.push(c.district);continue;}matched++;const u=await sql.query(`update raven_state_contacts set full_name=$2,title='Superintendent',email=$3,phone=$4,source_url=$5,verification_status='verified',verified_at=now(),evidence_note='Current superintendent contact published in the North Dakota statewide Insights Public School Districts 2025-2026 dataset.',updated_at=now() where id=$1 and verification_status in ('missing','candidate','rejected') returning id`,[s.id,c.fullName,c.email,c.phone,SOURCE])as any[];written+=u.length;}
 const after=(await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='ND' and scope='district' and role_key='superintendent'`)as any[])[0];
 return NextResponse.json({ok:true,state:'ND',source:SOURCE,parsed:list.length,matched,written,unmatchedSourceRecords:unmatched.length,unmatchedSample:unmatched.slice(0,20),before,after,verifiedAdded:Number(after.verified)-Number(before.verified)});
}
