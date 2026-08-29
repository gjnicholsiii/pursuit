import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Contact = {
  agencyLike?: string;
  scope: "state" | "district";
  role: "state_security_director" | "security_director" | "school_board" | "superintendent" | "assistant_superintendent" | "it_director";
  fullName: string;
  title: string;
  email?: string | null;
  phone?: string | null;
  source: string;
  note: string;
};

const contacts: Contact[] = [
  {
    scope: "state",
    role: "state_security_director",
    fullName: "Dr. Johnny H. Whaley",
    title: "School Facilities and Safety Administrator",
    email: "johnny.whaley@alsde.edu",
    phone: "334-694-0166",
    source: "https://www.alabamaachieves.org/wp-content/uploads/2025/12/SBOE_20251218_School-Security-Act-Presentation_v1.pdf",
    note: "Verified on ALSDE School Safety Team; current official School Security Act presentation identifies School Facilities and Safety Administrator. ALSDE FY26 safety correspondence confirms email/contact role."
  },
  {
    agencyLike: "Autauga County%",
    scope: "district",
    role: "superintendent",
    fullName: "Lyman Woodfin",
    title: "Superintendent",
    email: null,
    phone: "334-365-5706",
    source: "https://www.acboe.net/superintendent",
    note: "Verified on current official Autauga County Schools superintendent page."
  },
  {
    agencyLike: "Autauga County%",
    scope: "district",
    role: "school_board",
    fullName: "Jamie Jackson",
    title: "Board Chairman",
    email: "jamie.jackson@acboe.net",
    phone: "334-365-5706",
    source: "https://www.acboe.net/boardvacancy",
    note: "Verified by official Autauga County Schools board-vacancy notice; current chairman and direct district email published."
  },
  {
    agencyLike: "Autauga County%",
    scope: "district",
    role: "school_board",
    fullName: "Bradley D. Robbins",
    title: "District 1 Board Member",
    email: null,
    phone: "334-365-5706",
    source: "https://www.acboe.net/sys/content/newspost/2d57620e4ac14768b8e48be691d8db7a",
    note: "Verified by current official Autauga County Schools appointment announcement."
  },
  {
    agencyLike: "Baldwin County%",
    scope: "district",
    role: "superintendent",
    fullName: "Marty McRae",
    title: "Superintendent",
    email: null,
    phone: "251-937-0308",
    source: "https://www.bcbe.org/superintendent-senior-staff/superintendent",
    note: "Verified on current official Baldwin County Public Schools superintendent page."
  },
  {
    agencyLike: "Baldwin County%",
    scope: "district",
    role: "assistant_superintendent",
    fullName: "Joe Sharp",
    title: "Assistant Superintendent, Secondary Education",
    email: null,
    phone: "251-937-0306",
    source: "https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-secondary-education",
    note: "Verified on current official Baldwin County Public Schools senior staff page."
  },
  {
    agencyLike: "Baldwin County%",
    scope: "district",
    role: "it_director",
    fullName: "David Besancon, Ph.D., M.B.A.",
    title: "Assistant Superintendent, Educational Technology",
    email: null,
    phone: "251-937-0306",
    source: "https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-educational-technology",
    note: "Verified current district technology executive. Official BCBE handbook also identifies David Besancon as Ed Technology Director; current site title is Assistant Superintendent, Educational Technology."
  },
  {
    agencyLike: "Baldwin County%",
    scope: "district",
    role: "school_board",
    fullName: "Ken Bradley",
    title: "District 1 Board Member",
    email: null,
    phone: "251-406-8258",
    source: "https://www.bcbe.org/board-of-education/bcbe-board-members",
    note: "Verified on current official BCBE board roster."
  },
  {
    agencyLike: "Baldwin County%",
    scope: "district",
    role: "school_board",
    fullName: "Andrea Lindsey",
    title: "District 2 Board Member",
    email: null,
    phone: "251-586-4274",
    source: "https://www.bcbe.org/board-of-education/bcbe-board-members",
    note: "Verified on current official BCBE board roster."
  },
  {
    agencyLike: "Baldwin County%",
    scope: "district",
    role: "school_board",
    fullName: "Tony Myrick",
    title: "District 3 Board Member, Board President",
    email: null,
    phone: null,
    source: "https://www.bcbe.org/board-of-education/bcbe-board-members",
    note: "Verified on current official BCBE board roster."
  },
  {
    agencyLike: "Baldwin County%",
    scope: "district",
    role: "school_board",
    fullName: "Rondi Kirby",
    title: "District 4 Board Member",
    email: null,
    phone: null,
    source: "https://www.bcbe.org/board-of-education/bcbe-board-members",
    note: "Verified on current official BCBE board roster."
  },
  {
    agencyLike: "Baldwin County%",
    scope: "district",
    role: "school_board",
    fullName: "Jason P. Woerner",
    title: "District 5 Board Member",
    email: null,
    phone: "251-232-0038",
    source: "https://www.bcbe.org/board-of-education/bcbe-board-members",
    note: "Verified on current official BCBE board roster."
  },
  {
    agencyLike: "Baldwin County%",
    scope: "district",
    role: "school_board",
    fullName: "Cecil Christenberry",
    title: "District 6 Board Member",
    email: null,
    phone: null,
    source: "https://www.bcbe.org/board-of-education/bcbe-board-members",
    note: "Verified on current official BCBE board roster."
  },
  {
    agencyLike: "Baldwin County%",
    scope: "district",
    role: "school_board",
    fullName: "April Bradley",
    title: "District 7 Board Member, Board Vice President",
    email: null,
    phone: null,
    source: "https://www.bcbe.org/board-of-education/bcbe-board-members",
    note: "Verified on current official BCBE board roster."
  },
  {
    agencyLike: "Bibb County%",
    scope: "district",
    role: "superintendent",
    fullName: "Kevin Cotner",
    title: "Superintendent",
    email: "cotnerk@bibbed.org",
    phone: "205-926-9881",
    source: "https://www.bibbed.org/our-district/superintendent",
    note: "Verified on current official Bibb County Schools superintendent/staff pages."
  },
  {
    agencyLike: "Bibb County%",
    scope: "district",
    role: "school_board",
    fullName: "Camille Gibson",
    title: "Board President",
    email: null,
    phone: "205-926-9881",
    source: "https://www.bibbed.org/our-district/board-of-education/board-members",
    note: "Verified on current official Bibb County Schools board roster."
  },
  {
    agencyLike: "Bibb County%",
    scope: "district",
    role: "school_board",
    fullName: "Elaine Jones",
    title: "Board Vice President",
    email: null,
    phone: "205-926-9881",
    source: "https://www.bibbed.org/our-district/board-of-education/board-members",
    note: "Verified on current official Bibb County Schools board roster."
  },
  {
    agencyLike: "Bibb County%",
    scope: "district",
    role: "school_board",
    fullName: "Mike McMillan",
    title: "Board Member",
    email: null,
    phone: "205-926-9881",
    source: "https://www.bibbed.org/our-district/board-of-education/board-members",
    note: "Verified on current official Bibb County Schools board roster."
  },
  {
    agencyLike: "Bibb County%",
    scope: "district",
    role: "school_board",
    fullName: "Morris Moody",
    title: "Board Member",
    email: null,
    phone: "205-926-9881",
    source: "https://www.bibbed.org/our-district/board-of-education/board-members",
    note: "Verified on current official Bibb County Schools board roster."
  },
  {
    agencyLike: "Bibb County%",
    scope: "district",
    role: "school_board",
    fullName: "Cheryl Dodson",
    title: "Board Member",
    email: null,
    phone: "205-926-9881",
    source: "https://www.bibbed.org/our-district/board-of-education/board-members",
    note: "Verified on current official Bibb County Schools board roster."
  }
];

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();
  let written = 0;

  for (const c of contacts) {
    if (c.scope === "state") {
      const result = await sql.query(`
        update raven_state_contacts
        set full_name=$3,title=$4,email=$5,phone=$6,source_url=$7,verification_status='verified',verified_at=now(),evidence_note=$8,updated_at=now()
        where state_code=$1 and scope='state' and role_key=$2
        returning id
      `, ['AL', c.role, c.fullName, c.title, c.email ?? null, c.phone ?? null, c.source, c.note]) as any[];
      written += result.length;
      continue;
    }

    const agencies = await sql.query(`select id from agencies where state_code='AL' and agency_type='k12' and canonical_name ilike $1 order by canonical_name limit 1`, [c.agencyLike]) as any[];
    const agencyId = agencies[0]?.id;
    if (!agencyId) continue;

    const existing = await sql.query(`
      select id from raven_state_contacts
      where state_code='AL' and agency_id=$1 and role_key=$2 and lower(coalesce(full_name,''))=lower($3)
      order by id limit 1
    `, [agencyId, c.role, c.fullName]) as any[];

    if (existing.length) {
      await sql.query(`
        update raven_state_contacts
        set title=$2,email=$3,phone=$4,source_url=$5,verification_status='verified',verified_at=now(),evidence_note=$6,updated_at=now()
        where id=$1
      `, [existing[0].id, c.title, c.email ?? null, c.phone ?? null, c.source, c.note]);
      written++;
    } else {
      await sql.query(`
        insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note)
        select 'AL',a.county,a.id,'district',$2,$3,$4,$5,$6,$7,'verified',now(),$8
        from agencies a where a.id=$1
      `, [agencyId, c.role, c.fullName, c.title, c.email ?? null, c.phone ?? null, c.source, c.note]);
      written++;
    }
  }

  const summary = await sql.query(`
    select count(*)::int slots,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidates,
      count(*) filter(where verification_status='missing')::int missing,
      count(*) filter(where verification_status='rejected')::int rejected
    from raven_state_contacts where state_code='AL'
  `) as any[];
  console.log('RAVEN_ALABAMA_VERIFY', JSON.stringify({written, summary: summary[0]}));
  return NextResponse.json({ok:true,written,summary:summary[0]});
}
