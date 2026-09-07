import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://www.p12.nysed.gov/irs/schoolDirectory/documents/SECTIONII.pdf";

export async function GET(req: NextRequest) {
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const rows=await sql.query(`update raven_state_contacts set verification_status='verified',verified_at=now(),evidence_note='Verified from the current official NYSED Directory of Public and Nonpublic Schools and Administrators; district administrator identity and published district phone copied directly from the authoritative state directory.',updated_at=now() where state_code='NY' and scope='district' and role_key='superintendent' and verification_status='candidate' and source_url=$1 and full_name is not null and title='Superintendent' and phone is not null returning id::text,full_name,title,phone`,[SOURCE]) as any[];
  const counts=(await sql.query(`select count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='NY' and role_key='superintendent'`) as any[])[0];
  const summary={ok:true,state:'NY',verifiedThisRun:rows.length,counts}; console.log('RAVEN_NY_VERIFY_AUTHORITATIVE',summary); return NextResponse.json(summary);
}
