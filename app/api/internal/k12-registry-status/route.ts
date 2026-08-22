import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireInternalAuth(request);
  if (auth) return auth;

  const sql = getSql();
  const rows = await sql`
    select state_code, count(*)::int as agencies
    from agencies
    where agency_type = 'k12'
    group by state_code
    order by state_code
  `;
  const total = rows.reduce((sum, row) => sum + Number(row.agencies || 0), 0);
  return NextResponse.json({ ok: true, total, states: rows });
}
