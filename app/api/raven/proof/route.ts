import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

const FIX_AT = "2026-09-02T03:39:46.488Z";

export async function GET() {
  const sql = getSql();
  try {
    const [attempts, changed] = await Promise.all([
      sql.query(`
        select count(distinct agency_id)::int as districts_attempted,
               count(*)::int as missing_slots_touched
        from raven_state_contacts
        where scope='district'
          and updated_at >= $1::timestamptz
          and evidence_note like 'Raven crawl%'
      `, [FIX_AT]),
      sql.query(`
        select c.verification_status,c.full_name,c.title,c.role_key,c.updated_at,
               a.canonical_name,a.state_code
        from raven_state_contacts c
        left join agencies a on a.id=c.agency_id
        where c.updated_at >= $1::timestamptz
          and c.verification_status in ('candidate','verified','rejected')
        order by c.updated_at desc
        limit 100
      `, [FIX_AT])
    ]);
    return NextResponse.json({ok:true,fixAt:FIX_AT,attempts:attempts[0]||{},changed});
  } catch (error) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});
  }
}
