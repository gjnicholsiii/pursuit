import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  try {
    const rows = await sql.query(`
      select
        count(distinct agency_id)::int as attempted_last_hour,
        count(distinct agency_id) filter (
          where evidence_note ~* '^Raven crawl blocked:'
        )::int as blocked_last_hour,
        count(distinct agency_id) filter (
          where evidence_note ~* '^Raven crawl completed with zero eligible contacts'
        )::int as zero_yield_last_hour,
        count(distinct agency_id) filter (
          where evidence_note ~* '^Raven crawl attempted;'
        )::int as pending_last_hour
      from raven_state_contacts
      where scope='district'
        and updated_at >= now() - interval '1 hour'
        and evidence_note ~* '^Raven crawl (attempted|blocked|completed)'
    `) as any[];
    const untouched = await sql.query(`
      select count(distinct a.id)::int as untouched_districts
      from agencies a
      join raven_state_contacts c on c.agency_id=a.id
        and c.scope='district'
        and c.verification_status='missing'
      where a.agency_type='k12'
        and a.website is not null
        and btrim(a.website)<>''
        and coalesce(c.evidence_note,'') !~* '^Raven crawl (attempted|blocked|completed)'
    `) as any[];
    return NextResponse.json({ok:true,...rows[0],untouched_districts:untouched[0]?.untouched_districts ?? 0});
  } catch (error) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});
  }
}
