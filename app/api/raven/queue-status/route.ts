import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  try {
    const rows = await sql.query(`
      with district_evidence as (
        select
          c.agency_id,
          max(c.updated_at) filter (
            where coalesce(c.evidence_note,'') ~* '^Raven crawl (attempted|blocked|completed)'
          ) as last_attempt_at,
          bool_or(coalesce(c.evidence_note,'') ~* '^Raven crawl blocked') as ever_blocked,
          bool_or(coalesce(c.evidence_note,'') ~* '^Raven crawl completed with zero eligible contacts') as ever_zero_yield
        from raven_state_contacts c
        where c.scope='district'
        group by c.agency_id
      ),
      eligible as (
        select distinct a.id
        from agencies a
        join raven_state_contacts c on c.agency_id=a.id
        where a.agency_type='k12'
          and c.scope='district'
          and c.verification_status='missing'
          and a.website is not null
          and btrim(a.website)<>''
      )
      select
        count(*) filter (where d.last_attempt_at >= now() - interval '1 hour')::int as districts_attempted_last_hour,
        count(*) filter (where d.last_attempt_at >= now() - interval '1 hour' and d.ever_blocked)::int as blocked_last_hour,
        count(*) filter (where d.last_attempt_at >= now() - interval '1 hour' and d.ever_zero_yield)::int as zero_yield_last_hour,
        count(*) filter (where d.last_attempt_at is null)::int as untouched_eligible_districts,
        count(*)::int as eligible_missing_districts
      from eligible e
      left join district_evidence d on d.agency_id=e.id
    `) as any[];

    return NextResponse.json({ ok: true, ...(rows[0] || {}) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
