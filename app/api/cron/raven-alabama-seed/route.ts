import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const contacts = [
  {
    state_code: "AL", county: "Autauga", agency: "Autauga County", role_key: "superintendent",
    full_name: "Lyman Woodfin", title: "Superintendent", email: null,
    phone: "334-365-5706", source_url: "https://www.acboe.net/superintendentupdate022026",
    status: "verified", note: "Official Autauga County Schools superintendent update, February 2026."
  },
  {
    state_code: "AL", county: "Autauga", agency: "Autauga County", role_key: "it_director",
    full_name: "Tony Camara", title: "Technology", email: null,
    phone: "334-365-6697", source_url: "https://www.alabamaachieves.org/wp-content/uploads/2025/01/COMM_20250106_DAPS-2025_V1.0.pdf",
    status: "candidate", note: "Official ALSDE 2025 directory lists Tony Camara as Autauga County Technology key contact; exact director title still requires district confirmation."
  },
  {
    state_code: "AL", county: "Barbour", agency: "Barbour County", role_key: "superintendent",
    full_name: "Keith A. Stewart", title: "Superintendent", email: null,
    phone: "334-775-3453", source_url: "https://www.alabamaachieves.org/wp-content/uploads/2025/01/COMM_20250106_DAPS-2025_V1.0.pdf",
    status: "candidate", note: "Official ALSDE 2025 directory identifies Dr. Keith A. Stewart; current district superintendent page does not expose a name, so retained as candidate pending current official confirmation."
  },
  {
    state_code: "AL", county: "Barbour", agency: "Barbour County", role_key: "it_director",
    full_name: "Timothy Rumph", title: "Director of Technology", email: "timothy.rumph@barbourschools.org",
    phone: "3346210055", source_url: "https://www.barbourcountyschools.org/staff",
    status: "verified", note: "Current official Barbour County School District staff directory."
  }
] as const;

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();
  const results: any[] = [];

  for (const c of contacts) {
    const agencies = await sql.query(`select id::bigint id,canonical_name from agencies where state_code=$1 and agency_type='k12' and (canonical_name ilike $2 or coalesce(county,'') ilike $3) order by case when canonical_name ilike $2 then 0 else 1 end limit 1`, [c.state_code, `%${c.agency}%`, `%${c.county}%`]) as any[];
    const agencyId = agencies[0]?.id || null;

    const existing = await sql.query(`select id from raven_state_contacts where state_code=$1 and county=$2 and role_key=$3 and (agency_id=$4 or ($4 is null and agency_id is null)) and verification_status in ('missing','candidate') order by case when verification_status='missing' then 0 else 1 end,id limit 1`, [c.state_code,c.county,c.role_key,agencyId]) as any[];

    if (existing[0]?.id) {
      await sql.query(`update raven_state_contacts set agency_id=$2,scope='district',full_name=$3,title=$4,email=$5,phone=$6,source_url=$7,verification_status=$8,verified_at=case when $8='verified' then now() else null end,evidence_note=$9,updated_at=now() where id=$1`, [existing[0].id,agencyId,c.full_name,c.title,c.email,c.phone,c.source_url,c.status,c.note]);
    } else {
      await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values($1,$2,$3,'district',$4,$5,$6,$7,$8,$9,$10,case when $10='verified' then now() else null end,$11) on conflict do nothing`, [c.state_code,c.county,agencyId,c.role_key,c.full_name,c.title,c.email,c.phone,c.source_url,c.status,c.note]);
    }
    results.push({county:c.county,role:c.role_key,name:c.full_name,status:c.status});
  }

  const counts = await sql.query(`select verification_status,count(*)::int n from raven_state_contacts where state_code='AL' group by verification_status order by verification_status`) as any[];
  console.log('RAVEN_ALABAMA_SEED', JSON.stringify({results,counts}));
  return NextResponse.json({ok:true,results,counts});
}
