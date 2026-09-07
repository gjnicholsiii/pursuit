import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  const rows = await sql.query(`
    select a.canonical_name, c.full_name, c.title, c.source_url, c.verification_status
    from raven_state_contacts c
    join agencies a on a.id=c.agency_id
    where c.state_code='ID'
      and c.scope='district'
      and c.role_key='superintendent'
      and c.verification_status='candidate'
    order by a.canonical_name
  `) as any[];
  return NextResponse.json({ok:true,state:'ID',count:rows.length,rows});
}
