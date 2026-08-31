import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const records = [
  { state_code:"AZ", county:"Maricopa", org_hint:"Mesa", role_key:"superintendent", full_name:"Dr. Matt Strom", title:"Superintendent", email:"superintendent@mpsaz.org", phone:"480-472-0200", source_url:"https://www.mpsaz.org/page/superintendency", evidence_note:"Current official Mesa Public Schools superintendency page lists Dr. Matt Strom as Superintendent and publishes the superintendent email and district phone." },
  { state_code:"AZ", county:"Maricopa", org_hint:"Mesa", role_key:"security_director", full_name:"Jeff Solomon", title:"Director, School Safety & Security", email:null, phone:"480-472-0200", source_url:"https://departments.mpsaz.org/o/departments/page/security", evidence_note:"Current official Mesa Public Schools School Safety & Security page lists Jeff Solomon as Director. Direct email is not publicly exposed; district phone retained." },
  { state_code:"AZ", county:"Maricopa", org_hint:"Mesa", role_key:"it_director", full_name:"David Sanders", title:"Chief Technology Officer", email:null, phone:"480-472-0200", source_url:"https://departments.mpsaz.org/o/departments/page/infosys", evidence_note:"Current official Mesa Public Schools Information Systems page lists David Sanders as Chief Technology Officer. Direct email is not publicly exposed; district phone retained." },
  { state_code:"AZ", county:"Maricopa", org_hint:"Mesa", role_key:"school_board", full_name:"Courtney Davis", title:"Governing Board Member", email:null, phone:"480-472-0200", source_url:"https://www.mpsaz.org/article/1886869", evidence_note:"Official Mesa Public Schools 2024 election results list Courtney Davis as an elected Governing Board member beginning a four-year term in January 2025. Direct public email was not exposed on the current board page." },
  { state_code:"AR", county:"Benton", org_hint:"Bentonville", role_key:"superintendent", full_name:"Dr. Debbie Jones", title:"Superintendent", email:null, phone:"479-254-5000", source_url:"https://www.bentonvillek12.org/our-district/superintendent", evidence_note:"Current official Bentonville Schools superintendent page lists Dr. Debbie Jones as Superintendent. Direct email is not publicly exposed; district phone retained." },
  { state_code:"AR", county:"Benton", org_hint:"Bentonville", role_key:"security_director", full_name:"Steve Vera", title:"Director of Security & Safety", email:null, phone:"479-254-5000", source_url:"https://www.bentonvillek12.org/departments/security-safety", evidence_note:"Current official Bentonville Schools Security & Safety page lists Steve Vera as Director of Security and Safety. Direct email is not publicly exposed; district phone retained." },
  { state_code:"AR", county:"Benton", org_hint:"Bentonville", role_key:"it_director", full_name:"Aaron Nickles", title:"Executive Director of Technology", email:null, phone:"479-367-8088", source_url:"https://www.bentonvillek12.org/departments/technology", evidence_note:"Current official Bentonville Schools Technology page lists Aaron Nickles as Executive Director of Technology and publishes the technology help-desk phone. Direct email is not publicly exposed." },
  { state_code:"AR", county:"Benton", org_hint:"Bentonville", role_key:"school_board", full_name:"Jennifer Faddis", title:"School Board President", email:"jenniferfaddis@bentonvillek12.org", phone:"479-254-5000", source_url:"https://www.bentonvillek12.org/school-board/meet-the-board", evidence_note:"Current official Bentonville Schools board page lists Jennifer Faddis as President and publishes her district email." }
] as const;

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();
  const written:any[]=[];

  for (const r of records) {
    const agencies = await sql.query(`
      select id,canonical_name from agencies
      where agency_type='k12' and state_code=$1
        and regexp_replace(lower(coalesce(county,'')),'\\s+(county|municipality|city and borough|borough)$','')=regexp_replace(lower($2),'\\s+(county|municipality|city and borough|borough)$','')
        and canonical_name ilike '%'||$3||'%'
      order by id limit 1
    `,[r.state_code,r.county,r.org_hint]) as any[];
    const agencyId=agencies[0]?.id??null;
    const organization=agencies[0]?.canonical_name??null;

    const updated = await sql.query(`
      update raven_state_contacts c
      set agency_id=coalesce($1,c.agency_id),full_name=$5,title=$6,email=$7,phone=$8,source_url=$9,
          verification_status='verified',verified_at=now(),evidence_note=$10,updated_at=now()
      where c.state_code=$2
        and regexp_replace(lower(coalesce(c.county,'')),'\\s+(county|municipality|city and borough|borough)$','')=regexp_replace(lower($3),'\\s+(county|municipality|city and borough|borough)$','')
        and c.role_key=$4 and c.verification_status in ('missing','candidate')
      returning id
    `,[agencyId,r.state_code,r.county,r.role_key,r.full_name,r.title,r.email,r.phone,r.source_url,r.evidence_note]) as any[];

    let inserted=false;
    if(!updated.length){
      const exists=await sql.query(`
        select id from raven_state_contacts c where c.state_code=$1
          and regexp_replace(lower(coalesce(c.county,'')),'\\s+(county|municipality|city and borough|borough)$','')=regexp_replace(lower($2),'\\s+(county|municipality|city and borough|borough)$','')
          and c.role_key=$3 and c.verification_status='verified' and lower(coalesce(c.full_name,''))=lower($4)
        limit 1
      `,[r.state_code,r.county,r.role_key,r.full_name]) as any[];
      if(!exists.length){
        await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note,updated_at)
          values($1,$2,$3,'district',$4,$5,$6,$7,$8,$9,'verified',now(),$10,now())`,[r.state_code,r.county,agencyId,r.role_key,r.full_name,r.title,r.email,r.phone,r.source_url,r.evidence_note]);
        inserted=true;
      }
    }
    written.push({state:r.state_code,county:r.county,organization,role:r.role_key,name:r.full_name,updated:updated.length,inserted});
  }

  const totals=await sql.query(`select state_code,count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code in ('AZ','AR') group by state_code order by state_code`) as any[];
  console.log('RAVEN_OFFICIAL_BATCH_20260831',JSON.stringify({written,totals}));
  return NextResponse.json({ok:true,written,totals});
}
