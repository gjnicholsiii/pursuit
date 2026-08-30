import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Seed = {
  county: string | null;
  organization: string | null;
  scope: "state" | "district";
  role: "state_security_director" | "security_director" | "school_board" | "superintendent" | "assistant_superintendent" | "it_director";
  name: string;
  title: string;
  email?: string | null;
  phone?: string | null;
  source: string;
  status: "verified" | "candidate";
  note: string;
};

const seeds: Seed[] = [
  {
    county: null, organization: null, scope: "state", role: "state_security_director",
    name: "Erica Butler, Ed.D.", title: "Education Specialist - Crisis Management and School Safety",
    email: "erica.butler@alsde.edu", phone: "334-694-4717",
    source: "https://www.alabamaachieves.org/wp-content/uploads/2024/06/StateSuperIn_Memos_20240611_FY24-3027_School-Safety-and-nSide-Training-2024_V1.0.pdf",
    status: "candidate", note: "Official ALSDE School Safety Section source, but source is from 2024; retain as candidate until a current ALSDE source confirms the role."
  },
  {
    county: "Autauga", organization: "Autauga County", scope: "district", role: "superintendent",
    name: "Lyman Woodfin", title: "Superintendent, Autauga County Schools",
    email: null, phone: "334-365-5706", source: "https://eddir.alsde.edu/SiteInfo/PublicPrivateReligiousSites",
    status: "verified", note: "Current ALSDE Education Directory identifies Lyman Woodfin as Autauga County central-office administrator; district site also identifies him as superintendent."
  },
  {
    county: "Autauga", organization: "Autauga County", scope: "district", role: "it_director",
    name: "William Conyers", title: "Coordinator of Technology",
    email: null, phone: "334-223-6922", source: "https://www.alabamaachieves.org/wp-content/uploads/2025/01/COMM_20250106_DAPS-2025_V1.0.pdf",
    status: "candidate", note: "Official 2025 ALSDE directory lists William A. Conyers IV as central-office staff and technology contact evidence exists on the district site; title is Coordinator rather than Director, so do not promote to verified IT Director without current district confirmation."
  },
  {
    county: "Autauga", organization: "Autauga County", scope: "district", role: "school_board",
    name: "Bradley D. Robbins", title: "Board Member, District 1",
    email: null, phone: null, source: "https://www.acboe.net/sys/content/newspost/2d57620e4ac14768b8e48be691d8db7a",
    status: "verified", note: "Current official Autauga County Schools appointment announcement identifies Bradley D. Robbins as District 1 board member."
  },
  {
    county: "Autauga", organization: "Autauga County", scope: "district", role: "school_board",
    name: "Jamie Jackson", title: "Board Chairman",
    email: "jamie.jackson@acboe.net", phone: null, source: "https://www.acboe.net/boardvacancy",
    status: "verified", note: "Official district 2025 board-vacancy page identifies Jamie Jackson as Board Chairman and publishes district email."
  },
  {
    county: "Autauga", organization: "Autauga County", scope: "district", role: "school_board",
    name: "Kyle Glover", title: "Board Vice Chairman",
    email: null, phone: null, source: "https://www.acboe.net/boardvacancy",
    status: "candidate", note: "Official 2025 district page identifies Kyle Glover as Vice Chairman; keep candidate pending a current board roster."
  },
  {
    county: "Baldwin", organization: "Baldwin County", scope: "district", role: "superintendent",
    name: "Marty McRae", title: "Superintendent, Baldwin County Public Schools",
    email: "mmcrae@bcbe.org", phone: "251-937-0308", source: "https://www.bcbe.org/superintendent-senior-staff/superintendent",
    status: "verified", note: "Current official Baldwin County Public Schools superintendent page identifies Marty McRae as superintendent."
  },
  {
    county: "Baldwin", organization: "Baldwin County", scope: "district", role: "assistant_superintendent",
    name: "Joe Sharp", title: "Assistant Superintendent, Secondary Education",
    email: null, phone: null, source: "https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-secondary-education",
    status: "verified", note: "Current official district senior-staff page identifies Joe Sharp as Assistant Superintendent, Secondary Education."
  },
  {
    county: "Baldwin", organization: "Baldwin County", scope: "district", role: "it_director",
    name: "David Besancon, Ph.D., M.B.A.", title: "Assistant Superintendent, Education Technology",
    email: "dbesancon@bcbe.org", phone: null, source: "https://www.bcbe.org/bcbe-staff-directory?const_page=3",
    status: "verified", note: "Current official district staff directory identifies David Besancon as Assistant Superintendent Education Technology and publishes his district email."
  },
  {
    county: "Baldwin", organization: "Baldwin County", scope: "district", role: "school_board",
    name: "Ken Bradley", title: "Board Member, District 1", email: null, phone: "251-406-8258", source: "https://www.bcbe.org/board-of-education/bcbe-board-members", status: "verified", note: "Current official board roster."
  },
  {
    county: "Baldwin", organization: "Baldwin County", scope: "district", role: "school_board",
    name: "Andrea Lindsey", title: "Board Member, District 2", email: null, phone: "251-586-4274", source: "https://www.bcbe.org/board-of-education/bcbe-board-members", status: "verified", note: "Current official board roster."
  },
  {
    county: "Baldwin", organization: "Baldwin County", scope: "district", role: "school_board",
    name: "Tony Myrick", title: "Board President, District 3", email: null, phone: null, source: "https://www.bcbe.org/board-of-education/bcbe-board-members", status: "verified", note: "Current official board roster."
  },
  {
    county: "Baldwin", organization: "Baldwin County", scope: "district", role: "school_board",
    name: "Rondi Kirby", title: "Board Member, District 4", email: null, phone: null, source: "https://www.bcbe.org/board-of-education/bcbe-board-members", status: "verified", note: "Current official board roster."
  },
  {
    county: "Baldwin", organization: "Baldwin County", scope: "district", role: "school_board",
    name: "Jason P. Woerner", title: "Board Member, District 5", email: null, phone: "251-232-0038", source: "https://www.bcbe.org/board-of-education/bcbe-board-members", status: "verified", note: "Current official board roster."
  },
  {
    county: "Baldwin", organization: "Baldwin County", scope: "district", role: "school_board",
    name: "Cecil Christenberry", title: "Board Member, District 6", email: null, phone: null, source: "https://www.bcbe.org/board-of-education/bcbe-board-members", status: "verified", note: "Current official board roster."
  },
  {
    county: "Baldwin", organization: "Baldwin County", scope: "district", role: "school_board",
    name: "April Bradley", title: "Board Vice President, District 7", email: null, phone: null, source: "https://www.bcbe.org/board-of-education/bcbe-board-members", status: "verified", note: "Current official board roster."
  }
];

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();
  let applied = 0;

  for (const s of seeds) {
    let agencyId: string | null = null;
    if (s.organization) {
      const agencies = await sql.query(
        `select id::text from agencies where state_code='AL' and agency_type='k12' and (canonical_name=$1 or canonical_name=$1||' Schools' or canonical_name ilike $1||'%') order by case when canonical_name=$1 then 0 else 1 end limit 1`,
        [s.organization]
      ) as any[];
      agencyId = agencies[0]?.id || null;
    }

    if (s.role !== 'school_board') {
      const existing = await sql.query(
        `select id::text from raven_state_contacts where state_code='AL' and coalesce(county,'')=coalesce($1,'') and coalesce(agency_id,0)=coalesce($2::bigint,0) and scope=$3 and role_key=$4 order by case when full_name is null then 0 else 1 end,id limit 1`,
        [s.county, agencyId, s.scope, s.role]
      ) as any[];
      if (existing[0]?.id) {
        await sql.query(
          `update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,verification_status=$7,verified_at=case when $7='verified' then now() else null end,evidence_note=$8,updated_at=now() where id=$1`,
          [existing[0].id, s.name, s.title, s.email || null, s.phone || null, s.source, s.status, s.note]
        );
      } else {
        await sql.query(
          `insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values('AL',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,case when $10='verified' then now() else null end,$11) on conflict do nothing`,
          [s.county, agencyId, s.scope, s.role, s.name, s.title, s.email || null, s.phone || null, s.source, s.status, s.note]
        );
      }
    } else {
      await sql.query(
        `delete from raven_state_contacts where state_code='AL' and coalesce(county,'')=coalesce($1,'') and coalesce(agency_id,0)=coalesce($2::bigint,0) and role_key='school_board' and full_name is null`,
        [s.county, agencyId]
      );
      const found = await sql.query(
        `select id::text from raven_state_contacts where state_code='AL' and coalesce(county,'')=coalesce($1,'') and coalesce(agency_id,0)=coalesce($2::bigint,0) and role_key='school_board' and lower(coalesce(full_name,''))=lower($3) limit 1`,
        [s.county, agencyId, s.name]
      ) as any[];
      if (found[0]?.id) {
        await sql.query(`update raven_state_contacts set title=$2,email=$3,phone=$4,source_url=$5,verification_status=$6,verified_at=case when $6='verified' then now() else null end,evidence_note=$7,updated_at=now() where id=$1`, [found[0].id,s.title,s.email||null,s.phone||null,s.source,s.status,s.note]);
      } else {
        await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values('AL',$1,$2,'district','school_board',$3,$4,$5,$6,$7,$8,case when $8='verified' then now() else null end,$9)`, [s.county,agencyId,s.name,s.title,s.email||null,s.phone||null,s.source,s.status,s.note]);
      }
    }
    applied++;
  }

  const counts = await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='AL'`) as any[];
  console.log('RAVEN_ALABAMA_VERIFY_BATCH', JSON.stringify({applied, counts: counts[0]}));
  return NextResponse.json({ok:true, applied, counts:counts[0]});
}
