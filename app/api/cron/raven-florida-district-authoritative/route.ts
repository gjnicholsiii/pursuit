import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Seed = {
  agency: string;
  role: "assistant_superintendent" | "it_director" | "school_board";
  fullName: string;
  title: string;
  email?: string;
  phone?: string;
  sourceUrl: string;
  evidence: string;
};

const SEEDS: Seed[] = [
  {
    agency: "CLAY",
    role: "assistant_superintendent",
    fullName: "Bryce Ellis",
    title: "Assistant Superintendent for Operations",
    sourceUrl: "https://www.oneclay.net/page/operations",
    evidence: "Official Clay County District Schools Operations page lists Bryce Ellis as Assistant Superintendent for Operations."
  },
  {
    agency: "CLAY",
    role: "school_board",
    fullName: "Erin Skipper",
    title: "School Board Chair",
    sourceUrl: "https://www.oneclay.net/live_feeds/11945565",
    evidence: "Official Clay County District Schools April 2026 district post identifies Erin Skipper as School Board Chair."
  },
  {
    agency: "COLLIER",
    role: "assistant_superintendent",
    fullName: "Darren Burkett",
    title: "Deputy Superintendent",
    sourceUrl: "https://old.collierschools.com/cms/lib/FL01903251/Centricity/Domain/86/Part%201%20%20Table%20of%20Contents%20Introduction%20Millages%20Taxes%20and%20Projected%20Students%20Funds%20and%20Summaries.pdf",
    evidence: "Official Collier County Public Schools 2025-2026 budget publication lists Darren Burkett as Deputy Superintendent."
  },
  {
    agency: "COLLIER",
    role: "school_board",
    fullName: "Tim Moshier",
    title: "School Board Member",
    sourceUrl: "https://www.collierschools.com/exploreccps/school-board",
    evidence: "Current official Collier County Public Schools School Board page lists Tim Moshier as a board member."
  },
  {
    agency: "COLUMBIA",
    role: "assistant_superintendent",
    fullName: "Hope Jernigan",
    title: "Assistant Superintendent",
    email: "jerniganh@columbiak12.com",
    phone: "386-755-8015",
    sourceUrl: "https://www.columbiak12.com/assistant-superintendents",
    evidence: "Official Columbia County School District Assistant Superintendents page lists Hope Jernigan with district email and phone."
  },
  {
    agency: "COLUMBIA",
    role: "it_director",
    fullName: "Patrick Mitchell",
    title: "Director, Technology Infrastructure & Networking",
    sourceUrl: "https://www.columbiak12.com/technology",
    evidence: "Official Columbia County School District Technology page lists Patrick Mitchell as Director, Technology Infrastructure & Networking."
  },
  {
    agency: "COLUMBIA",
    role: "school_board",
    fullName: "Dana Brady-Giddens",
    title: "School Board Chairman",
    email: "bradyd@columbiak12.com",
    sourceUrl: "https://www.columbiak12.com/school-board",
    evidence: "Official Columbia County School District School Board page lists Dana Brady-Giddens as Chairman with district email."
  },
  {
    agency: "BAKER",
    role: "assistant_superintendent",
    fullName: "Thomas Hill",
    title: "Associate Superintendent of Schools",
    email: "thomas.hill@bakerk12.org",
    phone: "904-259-6251",
    sourceUrl: "https://www.bakerk12.org/about-us/our-educational-leaders",
    evidence: "Current official Baker County School District educational leaders page lists Thomas Hill as Associate Superintendent of Schools with district email and phone."
  },
  {
    agency: "BAKER",
    role: "school_board",
    fullName: "Jack Baker Jr.",
    title: "School Board Chairperson",
    email: "jack.baker@bakerk12.org",
    sourceUrl: "https://www.bakerk12.org/board-of-education/about-the-board/board-members",
    evidence: "Current official Baker County School District board page lists Jack Baker Jr. as Chairperson with district email."
  },
  {
    agency: "BAY",
    role: "school_board",
    fullName: "Jerry Register",
    title: "School Board Member",
    sourceUrl: "https://www.bay.k12.fl.us/page/school-board",
    evidence: "Current official Bay District Schools board page lists Jerry Register as a School Board member."
  },
  {
    agency: "DESOTO",
    role: "it_director",
    fullName: "Brent Scribner",
    title: "Director of Technology and Student Information Services",
    sourceUrl: "https://www.desotoschools.com/about/administration",
    evidence: "Current official School District of DeSoto County administration page lists Brent Scribner as Director of Technology and Student Information Services."
  },
  {
    agency: "DESOTO",
    role: "school_board",
    fullName: "Jami Schueneman",
    title: "School Board Chair",
    email: "jami.schueneman@desotoschools.com",
    sourceUrl: "https://www.desotoschools.com/school-board/board-members",
    evidence: "Current official School District of DeSoto County board page lists Jami Schueneman as Chair with district email."
  },
  {
    agency: "DIXIE",
    role: "it_director",
    fullName: "Tony Scott",
    title: "Technology Coordinator",
    email: "tonyscott@dixie.k12.fl.us",
    sourceUrl: "https://www.dixie.k12.fl.us/technologyservices",
    evidence: "Current official Dixie District Schools Technology Services page lists Tony Scott as Technology Coordinator with district email."
  },
  {
    agency: "DIXIE",
    role: "school_board",
    fullName: "Timothy Alexander",
    title: "School Board Chair",
    sourceUrl: "https://www.dixie.k12.fl.us/schoolboard",
    evidence: "Current official Dixie District Schools board page lists Timothy Alexander as District 4 Chair."
  },
  {
    agency: "FRANKLIN",
    role: "school_board",
    fullName: "Fonda Davis, Sr.",
    title: "School Board Chairman",
    sourceUrl: "https://www.franklincountyschools.org/our-district/board/franklin-county-school-board",
    evidence: "Current official Franklin County School District board page lists Fonda Davis, Sr. as Chairman."
  },
  {
    agency: "GADSDEN",
    role: "school_board",
    fullName: "Leroy McMillan",
    title: "School Board Chair",
    sourceUrl: "https://www.gadsdenschools.org/boardofeducation",
    evidence: "Current official Gadsden County Public Schools Board of Education page lists Leroy McMillan as District 3 Chair."
  },
  {
    agency: "HAMILTON",
    role: "assistant_superintendent",
    fullName: "Philip H. Pinello",
    title: "Assistant Superintendent",
    email: "philip.pinello@hamiltonfl.com",
    phone: "386-792-7815",
    sourceUrl: "https://www.hamiltonfl.com/55904_3",
    evidence: "Current official Hamilton County School District employment page lists Philip H. Pinello as Assistant Superintendent with district email and phone."
  },
  {
    agency: "HAMILTON",
    role: "it_director",
    fullName: "Amber Cribbs",
    title: "Coordinator of Information Technology",
    sourceUrl: "https://www.hamiltonfl.com/55902_3",
    evidence: "Current official Hamilton County School District Information Technology page lists Amber Cribbs as Coordinator of Information Technology."
  },
  {
    agency: "HAMILTON",
    role: "school_board",
    fullName: "Johnny Bullard",
    title: "School Board Chairman",
    email: "johnny.bullard@hamiltonfl.com",
    phone: "386-688-6080",
    sourceUrl: "https://www.hamiltonfl.com/93145_2",
    evidence: "Current official Hamilton County School District board page lists Johnny Bullard as Chairman with district email and phone."
  },
  {
    agency: "HARDEE",
    role: "assistant_superintendent",
    fullName: "Sherri Albritton",
    title: "Deputy Superintendent of Schools",
    sourceUrl: "https://www.hardee.k12.fl.us/article/1924951",
    evidence: "Official School Board of Hardee County district announcement identifies Sherri Albritton as Deputy Superintendent of Schools."
  },
  {
    agency: "HARDEE",
    role: "it_director",
    fullName: "Todd Markel",
    title: "Director, Information Technology",
    sourceUrl: "https://www.hardee.k12.fl.us/page/information-technology",
    evidence: "Current official School Board of Hardee County Information Technology page lists Todd Markel as Director."
  },
  {
    agency: "HARDEE",
    role: "school_board",
    fullName: "Mark Gilliard",
    title: "School Board Chair",
    email: "mgilliard@hardee.k12.fl.us",
    sourceUrl: "https://www.hardee.k12.fl.us/page/school-board",
    evidence: "Current official School Board of Hardee County board page lists Mark Gilliard as School Board Chair with district email."
  }
];

async function counts(sql: ReturnType<typeof getSql>) {
  const rows = await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='FL'`) as any[];
  return rows[0];
}

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();
  const before = await counts(sql);
  let filled = 0;
  const touched = new Set<string>();

  for (const seed of SEEDS) {
    const rows = await sql.query(`
      update raven_state_contacts c
      set full_name=$3,
          title=$4,
          email=coalesce($5,email),
          phone=coalesce($6,phone),
          source_url=$7,
          verification_status='verified',
          verified_at=now(),
          evidence_note=$8,
          updated_at=now()
      from agencies a
      where c.agency_id=a.id
        and c.state_code='FL'
        and upper(a.canonical_name)=upper($1)
        and c.role_key=$2
        and c.verification_status='missing'
      returning c.id::text
    `,[seed.agency,seed.role,seed.fullName,seed.title,seed.email??null,seed.phone??null,seed.sourceUrl,seed.evidence]) as any[];
    if (rows.length) {
      filled += rows.length;
      touched.add(seed.agency);
    }
  }

  const after = await counts(sql);
  const summary = {
    ok: true,
    state: "FL",
    mode: "official-district-authoritative",
    districtsNewlyAttempted: touched.size,
    filled,
    before,
    after,
    net: {
      total: after.total-before.total,
      verified: after.verified-before.verified,
      candidate: after.candidate-before.candidate,
      missing: after.missing-before.missing,
      rejected: after.rejected-before.rejected
    }
  };
  console.log("RAVEN_FL_DISTRICT_AUTHORITATIVE", summary);
  return NextResponse.json(summary);
}
