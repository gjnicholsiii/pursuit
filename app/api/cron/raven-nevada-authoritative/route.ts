import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://www.nvasb.org/page/superintendents/";

type Contact = { district:string; fullName:string; title:string; email:string };
type Slot = { id:string; agency_id:string; canonical_name:string; verification_status:string };

const CONTACTS: Contact[] = [
  {district:"Carson City School District",fullName:"Andrew Feuling",title:"Superintendent",email:"afeuling@carson.k12.nv.us"},
  {district:"Churchill County School District",fullName:"Derild Parsons",title:"Superintendent",email:"parsonsd@churchillcsd.com"},
  {district:"Clark County School District",fullName:"Jhone Ebert",title:"Interim Superintendent",email:"ebertj@nv.ccsd.net"},
  {district:"Douglas County School District",fullName:"Frankie Alvarado",title:"Superintendent",email:"falvarado@dcsd.k12.nv.us"},
  {district:"Elko County School District",fullName:"Clayton Anderson",title:"Superintendent",email:"canderson@ecsdnv.net"},
  {district:"Esmeralda County School District",fullName:"Johnathan Firme",title:"Superintendent",email:"jfirme@ecsdnv.org"},
  {district:"Eureka County School District",fullName:"Tate Else",title:"Superintendent",email:"telse@eureka.k12.nv.us"},
  {district:"Humboldt County School District",fullName:"Colby Corbitt",title:"Superintendent",email:"ccorbitt@hcsdnv.com"},
  {district:"Lander County School District",fullName:"Russ Klein",title:"Superintendent",email:"rklein@landernv.net"},
  {district:"Lincoln County School District",fullName:"Matt Cameron",title:"Superintendent",email:"mcameron@lcsdnv.com"},
  {district:"Lyon County School District",fullName:"Tim Logan",title:"Superintendent",email:"tlogan@lyoncsd.org"},
  {district:"Mineral County School District",fullName:"Stephanie Keuhey",title:"Superintendent",email:"keuhey.stephanie@nvmcsd.org"},
  {district:"Nye County School District",fullName:"Joseph H. Gent",title:"Superintendent",email:"jgent@nyeschools.org"},
  {district:"Pershing County School District",fullName:"Dennis Holmes",title:"Superintendent",email:"dholmes@pershing.k12.nv.us"},
  {district:"Storey County School District",fullName:"Joe Girdner",title:"Superintendent",email:"jgirdner@storey.k12.nv.us"},
  {district:"Washoe County School District",fullName:"Joe Ernst",title:"Superintendent",email:"Superintendent@washoeschools.net"},
  {district:"White Pine County School District",fullName:"Adam Young",title:"Superintendent",email:"adam.young@wpcnvadmin.com"}
];

function norm(v:string){return (v||"").toLowerCase().replace(/&/g," and ").replace(/\bcounty\b/g," ").replace(/\bpublic\b/g," ").replace(/\bschool district\b/g," ").replace(/\bschools\b/g," ").replace(/\bschool\b/g," ").replace(/\bdistrict\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function matchSlot(c:Contact,slots:Slot[]){const n=norm(c.district);const exact=slots.filter(s=>norm(s.canonical_name)===n);if(exact.length===1)return exact[0];const compact=n.replace(/\s+/g,"");const near=slots.filter(s=>{const x=norm(s.canonical_name).replace(/\s+/g,"");return x===compact || (x.length>4&&compact.length>4&&(x.includes(compact)||compact.includes(x)));});return near.length===1?near[0]:null;}
async function counts(sql:ReturnType<typeof getSql>){return (await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth; const sql=getSql();
  const before=await counts(sql);
  const beforeState=(await sql.query(`select count(*) filter(where verification_status='missing')::int missing from raven_state_contacts where state_code='NV' and role_key='superintendent'`) as any[])[0].missing;
  const slots=await sql.query(`select c.id::text,c.agency_id::text,a.canonical_name,c.verification_status from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code='NV' and c.scope='district' and c.role_key='superintendent'`) as Slot[];
  if(slots.length<17)return NextResponse.json({ok:false,state:'NV',error:'Nevada whole-state guard: fewer than 17 district superintendent slots',slots:slots.length,before,beforeStateMissing:beforeState},{status:502});
  let matched=0,filled=0,peopleWritten=0; const touched=new Set<string>(); const unmatched:string[]=[];
  for(const c of CONTACTS){const s=matchSlot(c,slots);if(!s){unmatched.push(c.district);continue;}matched++;touched.add(s.agency_id);
    await sql.query(`insert into raven_people(agency_id,full_name,title,role_family,email,phone,source_url,source_type,confidence,last_verified_at,updated_at) values($1,$2,$3,'Executive',$4,null,$5,'state_superintendent_association',95,now(),now()) on conflict(agency_id,full_name,title) do update set email=excluded.email,source_url=excluded.source_url,source_type=excluded.source_type,confidence=greatest(raven_people.confidence,excluded.confidence),last_verified_at=now(),updated_at=now()`,[s.agency_id,c.fullName,c.title,c.email,SOURCE]); peopleWritten++;
    const r=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=null,source_url=$5,verification_status='candidate',evidence_note='Current district superintendent and direct email published by the Nevada Association of School Boards statewide superintendent roster.',updated_at=now() where id=$1 and verification_status in ('missing','rejected') returning id`,[s.id,c.fullName,c.title,c.email,SOURCE]) as any[]; filled+=r.length;
  }
  const after=await counts(sql); const afterState=(await sql.query(`select count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='NV' and role_key='superintendent'`) as any[])[0];
  const summary={ok:true,state:'NV',role:'superintendent',source:SOURCE,sourceRecords:CONTACTS.length,districtsProcessedInBulk:touched.size,matched,unmatchedSourceRecords:unmatched.length,unmatched,peopleWritten,filled,beforeStateMissing:beforeState,afterState,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}}; console.log('RAVEN_NV_BULK',summary); return NextResponse.json(summary);
}
