import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Seed = {
  county: string | null;
  organization: string | null;
  scope: "state" | "district";
  role_key: "state_security_director" | "security_director" | "superintendent" | "assistant_superintendent" | "it_director";
  full_name: string;
  title: string;
  email?: string | null;
  phone?: string | null;
  source_url: string;
};

const seeds: Seed[] = [
  { county:null, organization:null, scope:"state", role_key:"state_security_director", full_name:"Ayanna Long", title:"Education Administrator – Title IV, Compliance Monitoring, Cohort, Section 504, School Safety", phone:"334-694-4717", source_url:"https://www.alabamaachieves.org/wp-content/uploads/2024/02/COMM_2024112_DAPS-2024_V1.0.pdf" },

  { county:"Pike", organization:"Pike County Schools", scope:"district", role_key:"superintendent", full_name:"Dr Mark Bazzell", title:"Superintendent", phone:"334-566-1850", source_url:"https://www.pikecountyschools.com/156150_2" },
  { county:"Pike", organization:"Pike County Schools", scope:"district", role_key:"assistant_superintendent", full_name:"Dr. Donnella Carter", title:"Associate Superintendent", phone:"334-566-1850", source_url:"https://www.pikecountyschools.com/156150_2" },
  { county:"Pike", organization:"Pike County Schools", scope:"district", role_key:"it_director", full_name:"Mrs. Stephanie Snyder", title:"Technology Director", phone:"334-566-1850", source_url:"https://www.pikecountyschools.com/156150_2" },

  { county:"Tallapoosa", organization:"Tallapoosa County Public Schools", scope:"district", role_key:"superintendent", full_name:"Casey D. Davis", title:"Superintendent", phone:"256-825-0746", source_url:"https://www.tallapoosak12.org/visit-campus" },
  { county:"Tallapoosa", organization:"Tallapoosa County Public Schools", scope:"district", role_key:"assistant_superintendent", full_name:"Dr. Penny Johnson", title:"Deputy Superintendent", phone:"256-825-0746", source_url:"https://www.tallapoosak12.org/visit-campus" },
  { county:"Tallapoosa", organization:"Tallapoosa County Public Schools", scope:"district", role_key:"it_director", full_name:"Mr. Joel Padgett", title:"Director of Technology", phone:"256-825-0746", source_url:"https://www.tallapoosak12.org/visit-campus" },

  { county:"Pickens", organization:"Pickens County Schools", scope:"district", role_key:"superintendent", full_name:"Jeff Campbell", title:"Superintendent", email:"campbellj@pickens.k12.al.us", phone:"205-367-2080", source_url:"https://www.pickenscountyschools.net/staff-directory" },
  { county:"Pickens", organization:"Pickens County Schools", scope:"district", role_key:"it_director", full_name:"Ken Ryals", title:"Director of Technology", email:"ryalsk@pickens.k12.al.us", phone:"205-367-2080", source_url:"https://www.pickenscountyschools.net/departments/technology" },

  { county:"Elmore", organization:"Elmore County Board of Education", scope:"district", role_key:"it_director", full_name:"Nic Cardwell", title:"Director of Technology", phone:"334-567-1200", source_url:"https://www.elmoreco.com/staffmanual" },

  { county:"Lamar", organization:"Lamar County School District", scope:"district", role_key:"superintendent", full_name:"Vance Herron", title:"Superintendent", phone:"205-695-7615", source_url:"https://lamarcountyk12.com/en-US/staff" },
  { county:"Lamar", organization:"Lamar County School District", scope:"district", role_key:"it_director", full_name:"Darren Gottwald", title:"Technology Director", phone:"205-695-7615", source_url:"https://lamarcountyk12.com/en-US/staff" },

  { county:"Walker", organization:"Walker County Board Of Education", scope:"district", role_key:"security_director", full_name:"Patrick Gann", title:"Technology Director, School Safety Director, Handbook and Calendar Coordinator, PowerSchool Manager", phone:"205-387-0555", source_url:"https://www.walkercountyschools.com/services/technology/technology-department" },
  { county:"Walker", organization:"Walker County Board Of Education", scope:"district", role_key:"it_director", full_name:"Patrick Gann", title:"Technology Director, School Safety Director, Handbook and Calendar Coordinator, PowerSchool Manager", phone:"205-387-0555", source_url:"https://www.walkercountyschools.com/services/technology/technology-department" },

  { county:"Tuscaloosa", organization:"Tuscaloosa County School System", scope:"district", role_key:"superintendent", full_name:"Dr. Daniel Bray", title:"Superintendent", phone:"205-758-0411", source_url:"https://www.tcss.net/about-tcss/superintendent-district-administration" },
  { county:"Tuscaloosa", organization:"Tuscaloosa County School System", scope:"district", role_key:"it_director", full_name:"Brad Jessen", title:"Director of Information Technology", phone:"205-342-2635", source_url:"https://www.tcss.net/departments/information-technology" },

  { county:"Fayette", organization:"Fayette County Schools", scope:"district", role_key:"superintendent", full_name:"Jim Burkhalter", title:"Superintendent of Fayette County Schools", email:"jburkhalter@fayette.k12.al.us", phone:"205-932-4611 Ext. 1001", source_url:"https://www.fayette.k12.al.us/our-district/district-staff/administative-staff" },
  { county:"Fayette", organization:"Fayette County Schools", scope:"district", role_key:"assistant_superintendent", full_name:"Mary Raines", title:"Deputy Superintendent and Federal Programs", email:"mraines@fayette.k12.al.us", phone:"205-932-4611 Ext. 1010", source_url:"https://www.fayette.k12.al.us/our-district/district-staff/administative-staff" },
];

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();
  let upserted = 0;

  for (const s of seeds) {
    let agencyId: string | null = null;
    if (s.organization) {
      const matches = await sql.query(`
        select id::text from agencies
        where state_code='AL' and agency_type='k12'
          and (lower(canonical_name)=lower($1) or (county is not null and lower(county)=lower($2)))
        order by case when lower(canonical_name)=lower($1) then 0 else 1 end, canonical_name
        limit 1
      `, [s.organization, s.county || ""]) as any[];
      agencyId = matches[0]?.id || null;
    }

    const existing = await sql.query(`
      select id::text from raven_state_contacts
      where state_code='AL' and coalesce(county,'')=coalesce($1,'')
        and coalesce(agency_id::text,'')=coalesce($2,'') and scope=$3 and role_key=$4
        and lower(coalesce(full_name,''))=lower($5)
      limit 1
    `, [s.county, agencyId, s.scope, s.role_key, s.full_name]) as any[];

    if (existing[0]?.id) {
      await sql.query(`update raven_state_contacts set title=$2,email=$3,phone=$4,source_url=$5,verification_status='verified',verified_at=now(),evidence_note='Verified from official public organization source.',updated_at=now() where id=$1`, [existing[0].id,s.title,s.email||null,s.phone||null,s.source_url]);
    } else {
      await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values('AL',$1,$2,$3,$4,$5,$6,$7,$8,$9,'verified',now(),'Verified from official public organization source.')`, [s.county,agencyId,s.scope,s.role_key,s.full_name,s.title,s.email||null,s.phone||null,s.source_url]);
    }
    upserted++;
  }

  const counts = await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='AL'`) as any[];
  console.log('RAVEN_ALABAMA_OFFICIAL_SEED', JSON.stringify({upserted,...counts[0]}));
  return NextResponse.json({ok:true,upserted,...counts[0]});
}
