import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sql = getSql();
  const requestedState = (req.nextUrl.searchParams.get("state") || "").toUpperCase();
  const wantMissing = req.nextUrl.searchParams.get("missing") === "1";

  if (wantMissing && /^[A-Z]{2}$/.test(requestedState)) {
    const missing = await sql.query(`
      select c.id::text,c.state_code,c.county,c.agency_id::text,a.canonical_name organization,
        c.role_key,c.verification_status,a.website
      from raven_state_contacts c
      join agencies a on a.id=c.agency_id
      where c.verification_status='missing'
        and c.scope='district'
        and c.state_code=$1
      order by c.county,a.canonical_name,c.role_key
      limit 250
    `,[requestedState]);
    return NextResponse.json({ok:true,state:requestedState,missing});
  }

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
