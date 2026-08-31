import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

const records = [
  { state_code:"AL", county:null, scope:"state", role_key:"state_security_director", full_name:"Dr. Autumm Jeter", title:"Assistant State Superintendent, Support Services", email:"autumm.jeter@alsde.edu", phone:"334-694-4868", source_url:"https://www.alabamaachieves.org/school-facilities/", evidence_note:"ALSDE identifies Dr. Autumm Jeter as Assistant State Superintendent; ALSDE Support Services explicitly includes School Safety. Current 2026 ALSDE school-safety memoranda list her as a school-safety contact." },
  { state_code:"AL", county:"Lamar", scope:"district", role_key:"superintendent", full_name:"Vance Herron", title:"Superintendent", email:null, phone:"205-695-7615", source_url:"https://lamarcountyk12.com/en-US/staff", evidence_note:"Official Lamar County School District staff directory." },
  { state_code:"AL", county:"Lamar", scope:"district", role_key:"it_director", full_name:"Darren Gottwald", title:"Technology Director", email:null, phone:"205-695-7615", source_url:"https://lamarcountyk12.com/en-US/staff", evidence_note:"Official Lamar County School District staff directory." },
  { state_code:"AL", county:"Tallapoosa", scope:"district", role_key:"superintendent", full_name:"Casey D. Davis", title:"Superintendent", email:null, phone:"256-825-0746", source_url:"https://www.tallapoosak12.org/visit-campus", evidence_note:"Official Tallapoosa County Public Schools district staff directory." },
  { state_code:"AL", county:"Tallapoosa", scope:"district", role_key:"assistant_superintendent", full_name:"Dr. Penny Johnson", title:"Deputy Superintendent", email:null, phone:"256-825-0746", source_url:"https://www.tallapoosak12.org/visit-campus", evidence_note:"Official Tallapoosa County Public Schools district staff directory; deputy superintendent accepted as assistant-superintendent equivalent." },
  { state_code:"AL", county:"Tallapoosa", scope:"district", role_key:"it_director", full_name:"Joel Padgett", title:"Director of Technology", email:null, phone:"256-825-0746", source_url:"https://www.tallapoosak12.org/visit-campus", evidence_note:"Official Tallapoosa County Public Schools district staff directory." },
  { state_code:"AL", county:"Madison", scope:"district", role_key:"it_director", full_name:"Nikki Rodman", title:"Director of Information Technology", email:null, phone:"256-852-2557", source_url:"https://www.mcssk12.org/our-district/district-leadership/directors", evidence_note:"Official Madison County Schools directors page." },
  { state_code:"AL", county:"Pickens", scope:"district", role_key:"superintendent", full_name:"Jeff Campbell", title:"Superintendent", email:"campbellj@pickens.k12.al.us", phone:null, source_url:"https://www.pickenscountyschools.net/staff-directory", evidence_note:"Official Pickens County Schools staff directory." }
];

export async function GET() {
  const sql = getSql();
  let written = 0;
  for (const r of records) {
    const agency = r.county ? await sql.query(`select id from agencies where agency_type='k12' and state_code='AL' and (county ilike $1 or canonical_name ilike $2) order by case when county ilike $1 then 0 else 1 end limit 1`, [r.county, `%${r.county}%County%`]) as any[] : [];
    const agencyId = agency[0]?.id || null;
    await sql.query(`
      insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note,updated_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verified',now(),$11,now())
      on conflict do nothing
    `,[r.state_code,r.county,agencyId,r.scope,r.role_key,r.full_name,r.title,r.email,r.phone,r.source_url,r.evidence_note]);
    await sql.query(`
      update raven_state_contacts set full_name=$6,title=$7,email=$8,phone=$9,source_url=$10,verification_status='verified',verified_at=now(),evidence_note=$11,updated_at=now()
      where state_code=$1 and coalesce(county,'')=coalesce($2,'') and scope=$4 and role_key=$5 and (full_name is null or full_name=$6)
    `,[r.state_code,r.county,agencyId,r.scope,r.role_key,r.full_name,r.title,r.email,r.phone,r.source_url,r.evidence_note]);
    written++;
  }
  const summary = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='AL'`) as any[];
  return NextResponse.json({ok:true,written,summary:summary[0]});
}
