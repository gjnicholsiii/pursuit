import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const CAMPAIGN = "campus-security-advisory-v1";

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;

  const sql = getSql();
  const totals = await sql.query(`
    select
      count(*) filter (where s.status='sent')::int as sent,
      count(*) filter (where s.status='failed')::int as failed,
      count(*) filter (where s.status='pending')::int as pending,
      count(*)::int as total
    from raven_outreach_sends s
    join raven_outreach_batches b on b.id=s.batch_id
    where b.campaign=$1
  `, [CAMPAIGN]) as any[];

  const batches = await sql.query(`
    select b.batch_number,b.status,b.target_count,b.sent_count,b.failed_count,
      count(*) filter (where s.status='sent')::int as actual_sent,
      count(*) filter (where s.status='failed')::int as actual_failed,
      count(*) filter (where s.status='pending')::int as actual_pending,
      count(*)::int as actual_total
    from raven_outreach_batches b
    left join raven_outreach_sends s on s.batch_id=b.id
    where b.campaign=$1
    group by b.id,b.batch_number,b.status,b.target_count,b.sent_count,b.failed_count
    order by b.batch_number
  `, [CAMPAIGN]) as any[];

  const today = await sql.query(`
    select count(*)::int as sent_today
    from raven_outreach_sends s
    join raven_outreach_batches b on b.id=s.batch_id
    where b.campaign=$1
      and s.status='sent'
      and timezone('America/Chicago', s.sent_at)::date = timezone('America/Chicago', now())::date
  `, [CAMPAIGN]) as any[];

  const snapshot = {
    campaign: CAMPAIGN,
    paused: true,
    sent: Number(totals[0]?.sent || 0),
    failed: Number(totals[0]?.failed || 0),
    pending: Number(totals[0]?.pending || 0),
    total: Number(totals[0]?.total || 0),
    sentToday: Number(today[0]?.sent_today || 0),
    batches,
  };

  console.log("RAVEN_RECONCILIATION_SNAPSHOT", JSON.stringify(snapshot));
  return NextResponse.json({ ok: true, ...snapshot });
}
