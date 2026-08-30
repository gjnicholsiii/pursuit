import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();
  const state = (req.nextUrl.searchParams.get("state") || "AL").toUpperCase().slice(0, 2);

  const counts = await sql.query(`
    select count(*)::int total,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidate,
      count(*) filter(where verification_status='missing')::int missing,
      count(*) filter(where verification_status='rejected')::int rejected
    from raven_state_contacts where state_code=$1
  `, [state]) as any[];

  const byRole = await sql.query(`
    select role_key,
      count(*)::int total,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidate,
      count(*) filter(where verification_status='missing')::int missing,
      count(*) filter(where verification_status='rejected')::int rejected
    from raven_state_contacts where state_code=$1
    group by role_key order by role_key
  `, [state]) as any[];

  const incomplete = await sql.query(`
    select coalesce(county,'STATE') county, coalesce(a.canonical_name,'State-level') organization, role_key, verification_status,
      full_name, title
    from raven_state_contacts c
    left join agencies a on a.id=c.agency_id
    where c.state_code=$1 and c.verification_status<>'verified'
    order by coalesce(county,''), organization, role_key, verification_status
  `, [state]) as any[];

  const snapshot = { state, ...counts[0], byRole, incomplete };
  console.log('RAVEN_CONTACT_AUDIT', JSON.stringify(snapshot));
  return NextResponse.json({ ok: true, ...snapshot });
}
