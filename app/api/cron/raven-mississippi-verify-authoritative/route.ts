import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://mdek12.org/dd/";

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();
  const rows = await sql.query(`
    update raven_state_contacts
    set verification_status='verified',
        verified_at=now(),
        evidence_note='Verified from the current Mississippi Department of Education statewide District Directory; superintendent identity and published contact fields were copied directly from the authoritative state roster.',
        updated_at=now()
    where state_code='MS'
      and scope='district'
      and role_key='superintendent'
      and verification_status='candidate'
      and source_url=$1
      and full_name is not null
      and title ~* 'superintendent'
    returning id::text, full_name, title, email, phone
  `,[SOURCE]) as any[];
  const counts=(await sql.query(`select count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code='MS' and role_key='superintendent'`) as any[])[0];
  const summary={ok:true,state:'MS',verifiedThisRun:rows.length,counts};
  console.log('RAVEN_MS_VERIFY_AUTHORITATIVE',summary);
  return NextResponse.json(summary);
}
