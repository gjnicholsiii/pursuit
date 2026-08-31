import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CAMPAIGN = "campus-security-advisory-v1";

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  const rows = await sql.query(`
    select
      count(*) filter(where s.status='sent')::int sent,
      count(*) filter(where s.status='failed')::int failed,
      count(*) filter(where s.status='pending')::int pending,
      count(*)::int total
    from raven_outreach_sends s
    join raven_outreach_batches b on b.id=s.batch_id
    where b.campaign=$1
  `,[CAMPAIGN]) as any[];

  return NextResponse.json({
    ok:true,
    paused:true,
    campaign:CAMPAIGN,
    blocker:"Outreach hard-paused while Raven school-security contact database is rebuilt and reviewed.",
    ...(rows[0] || {sent:0,failed:0,pending:0,total:0})
  });
}
