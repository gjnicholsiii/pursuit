import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  const states = await sql.query(`
    select state_code,
      count(*)::int slots,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidate,
      count(*) filter(where verification_status='missing')::int missing,
      count(*) filter(where verification_status='rejected')::int rejected,
      max(updated_at) latest_update
    from raven_state_contacts
    group by state_code
    order by state_code
  `);
  const totals = await sql.query(`
    select count(*)::int slots,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidate,
      count(*) filter(where verification_status='missing')::int missing,
      count(*) filter(where verification_status='rejected')::int rejected,
      max(updated_at) latest_update
    from raven_state_contacts
  `);
  return NextResponse.json({ ok: true, totals: totals[0] || null, states });
}
