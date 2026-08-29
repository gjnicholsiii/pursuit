import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  const verified = [
    ['Baldwin County','superintendent','Marty McRae','Superintendent','mmcrae@bcbe.org','251-937-0308','https://www.bcbe.org/superintendent-senior-staff/superintendent','Current official superintendent page; ALSDE transportation directory supplies current district email.'],
    ['Baldwin County','security_director','Jeff Spaller','Safety Supervisor','jspaller@bcbe.org','251-972-6854','https://www.bcbe.org/departments/athletics-prevention-safety/safety','Official BCBE Safety page identifies Safety Supervisor, phone, and email link.'],
    ['Baldwin County','assistant_superintendent','Joe Sharp','Assistant Superintendent, Secondary Education','jsharp@bcbe.org','251-970-7322','https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-secondary-education','Current official senior staff page identifies role; official BCBE handbook supplies email and phone.'],
    ['Baldwin County','it_director','David Besancon, Ph.D., M.B.A.','Assistant Superintendent, Educational Technology','dbesancon@bcbe.org','251-972-6850','https://www.bcbe.org/bcbe-staff-directory?const_page=3','Official BCBE staff directory identifies role, email, and department.'],
    ['Baldwin County','school_board','Ken Bradley','Board Member, District 1',null,'251-406-8258','https://www.bcbe.org/board-of-education/bcbe-board-members','Official BCBE board page identifies current member and phone.']
  ] as const;

  for (const [county,role,fullName,title,email,phone,source,note] of verified) {
    await sql.query(`
      update raven_state_contacts c
      set full_name=$3,title=$4,email=$5,phone=$6,source_url=$7,verification_status='verified',verified_at=now(),evidence_note=$8,updated_at=now()
      from agencies a
      where c.agency_id=a.id and c.state_code='AL' and c.county=$1 and c.role_key=$2
        and (a.jurisdiction_level='county' or a.canonical_name ilike '%county%')
    `,[county,role,fullName,title,email,phone,source,note]);
  }

  await sql.query(`
    update raven_state_contacts
    set full_name='Johnny Whaley', title='Education Administrator II; School Safety Section contact', email='johnny.whaley@alsde.edu', phone='334-694-4717',
        source_url='https://www.alabamaachieves.org/wp-content/uploads/2025/04/StateSuperIn_Memos_20250410_FY25-3027-School-Safety-and-nSide-Training-2025_v1.0.pdf',
        verification_status='candidate', evidence_note='ALSDE school-safety memo names Dr. Johnny Whaley as a School Safety Section contact; official School Facilities page confirms his Education Administrator II title. Functional fit is strong but title is not explicitly State Security Director.', updated_at=now()
    where state_code='AL' and scope='state' and role_key='state_security_director' and verification_status<>'verified'
  `);

  const summary = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing from raven_state_contacts where state_code='AL'`) as any[];
  console.log('RAVEN_ALABAMA_VERIFIED_PROGRESS', JSON.stringify(summary[0] || {}));
  return NextResponse.json({ok:true,state:'AL',summary:summary[0] || {}});
}
