import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const records = [
  {
    state_code: "AL", county: null, scope: "state", role_key: "state_security_director",
    full_name: "Johnny H. Whaley", title: "School Facilities and Safety Administrator",
    email: "johnny.whaley@alsde.edu", phone: "334-694-0166",
    source_url: "https://www.alabamaachieves.org/wp-content/uploads/2025/12/SBOE_20251218_School-Security-Act-Presentation_v1.pdf",
    verification_status: "verified",
    evidence_note: "ALSDE School Security Act presentation identifies Dr. Johnny H. Whaley as School Facilities and Safety Administrator; FY26 ALSDE student-incident memo lists him as a current school-safety contact."
  },
  {
    state_code: "AL", county: "Autauga", scope: "district", role_key: "superintendent",
    full_name: "Lyman Woodfin", title: "Superintendent",
    email: null, phone: "334-365-5706",
    source_url: "https://www.acboe.net/superintendentupdate032024",
    verification_status: "verified",
    evidence_note: "Official Autauga County Schools superintendent update identifies Lyman Woodfin as Superintendent; district central-office phone is published on the same official site."
  },
  {
    state_code: "AL", county: "Autauga", scope: "district", role_key: "school_board",
    full_name: "Jamie Jackson", title: "Board Chairman",
    email: null, phone: "334-365-5706",
    source_url: "https://www.acboe.net/sys/content/newspost/2d57620e4ac14768b8e48be691d8db7a",
    verification_status: "verified",
    evidence_note: "Official Autauga County Schools announcement identifies Jamie Jackson as Autauga County Board of Education Chairman."
  },
  {
    state_code: "AL", county: "Autauga", scope: "district", role_key: "it_director",
    full_name: "William Conyers", title: "Coordinator of Technology",
    email: null, phone: null,
    source_url: "https://www.acboe.net/newemployees",
    verification_status: "candidate",
    evidence_note: "Official Autauga County Schools personnel record shows William Conyers appointed Coordinator of Technology in 2024; current 2026 district contacts confirm an Information Technology department but do not expose the current staff name in searchable text, so this remains candidate pending current confirmation."
  }
] as const;

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  await sql.query(`create table if not exists raven_state_contacts (
    id bigserial primary key,
    state_code text not null,
    county text,
    agency_id bigint references agencies(id) on delete set null,
    scope text not null,
    role_key text not null,
    full_name text,
    title text,
    email text,
    phone text,
    source_url text,
    verification_status text not null default 'missing',
    verified_at timestamptz,
    evidence_note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`);

  for (const r of records) {
    const agencies = r.county ? await sql.query(`select id from agencies where agency_type='k12' and state_code='AL' and county=$1 order by case when jurisdiction_level='county' or canonical_name ilike '%county%' then 0 else 1 end, canonical_name limit 1`, [r.county]) as any[] : [];
    const agencyId = agencies[0]?.id || null;
    const existing = await sql.query(`select id from raven_state_contacts where state_code=$1 and coalesce(county,'')=coalesce($2,'') and scope=$3 and role_key=$4 and coalesce(lower(full_name),'')=lower($5) limit 1`, [r.state_code,r.county,r.scope,r.role_key,r.full_name]) as any[];
    if (existing[0]?.id) {
      await sql.query(`update raven_state_contacts set agency_id=coalesce($2,agency_id),title=$3,email=$4,phone=$5,source_url=$6,verification_status=$7,verified_at=case when $7='verified' then now() else verified_at end,evidence_note=$8,updated_at=now() where id=$1`, [existing[0].id,agencyId,r.title,r.email,r.phone,r.source_url,r.verification_status,r.evidence_note]);
    } else {
      await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,case when $11='verified' then now() else null end,$12)`, [r.state_code,r.county,agencyId,r.scope,r.role_key,r.full_name,r.title,r.email,r.phone,r.source_url,r.verification_status,r.evidence_note]);
    }
  }

  const counts = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='AL'`) as any[];
  console.log('RAVEN_ALABAMA_PROGRESS', JSON.stringify(counts[0] || {}));
  return NextResponse.json({ok:true,state:'AL',...(counts[0] || {})});
}
