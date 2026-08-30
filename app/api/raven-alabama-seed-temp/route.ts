import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  await sql.query(`
    update raven_state_contacts
    set full_name='Shaundalyn Elliott',
        title='Education Specialist - School Safety',
        email='selliott@alsde.edu',
        phone='334-694-4717',
        source_url='https://www.alabamaachieves.org/wp-content/uploads/2025/01/COMM_20250106_DAPS-2025_V1.0.pdf',
        verification_status='verified',
        verified_at=now(),
        evidence_note='ALSDE 2025 Directory places Elliott in SCHOOL SAFETY; ALSDE FY24-3027 school-safety memo provides selliott@alsde.edu and 334-694-4717.',
        updated_at=now()
    where state_code='AL' and scope='state' and role_key='state_security_director'
  `);
  const rows = await sql.query(`select state_code,scope,role_key,full_name,title,email,phone,verification_status from raven_state_contacts where state_code='AL' and scope='state' and role_key='state_security_director'`);
  return NextResponse.json({ok:true, rows});
}
