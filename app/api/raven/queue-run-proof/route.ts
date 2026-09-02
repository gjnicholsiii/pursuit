import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(){
  const sql=getSql();
  const totals=await sql.query(`select count(*)::int slots,
    count(*) filter(where verification_status='verified')::int verified,
    count(*) filter(where verification_status='candidate')::int candidate,
    count(*) filter(where verification_status='missing')::int missing,
    count(*) filter(where verification_status='rejected')::int rejected
    from raven_state_contacts`) as any[];
  const attempted=await sql.query(`select count(distinct agency_id)::int districts_attempted_last_hour
    from raven_state_contacts
    where scope='district' and agency_id is not null
      and updated_at >= now() - interval '1 hour'
      and coalesce(evidence_note,'') ~* '^Raven crawl (attempted|blocked|completed)'`) as any[];
  const untouched=await sql.query(`select count(distinct a.id)::int untouched_districts
    from agencies a join raven_state_contacts c on c.agency_id=a.id and c.scope='district' and c.verification_status='missing'
    where a.agency_type='k12' and a.website is not null and btrim(a.website)<>''
      and coalesce(c.evidence_note,'') !~* '^Raven crawl (attempted|blocked|completed)'`) as any[];
  return NextResponse.json({ok:true,totals:totals[0],...attempted[0],...untouched[0],at:new Date().toISOString()});
}
