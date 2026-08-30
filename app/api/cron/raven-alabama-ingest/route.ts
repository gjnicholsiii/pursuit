import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const records = [
  {
    state_code: "AL", county: "Barbour", scope: "district", role_key: "superintendent",
    full_name: "Jimmie C. Fryer", title: "Superintendent",
    email: null, phone: "334-775-3453",
    source_url: "https://www.barbourcountyschools.org/article/2886265",
    evidence_note: "Official Barbour County School District May 11, 2026 announcement identifies Mr. Jimmie Fryer as Barbour County Schools Superintendent; district central-office phone is published on the official district site."
  },
  {
    state_code: "AL", county: "Barbour", scope: "district", role_key: "it_director",
    full_name: "Geoff Jones", title: "Executive Director of Technology",
    email: null, phone: "334-775-3453",
    source_url: "https://www.barbourcountyschools.org/page/technology",
    evidence_note: "Current official Barbour County School District Technology page identifies Geoff Jones as Executive Director of Technology and publishes the district technology contact number."
  }
] as const;

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  for (const r of records) {
    const existing = await sql.query(
      `select id from raven_state_contacts where state_code=$1 and county=$2 and scope=$3 and role_key=$4 and lower(coalesce(full_name,''))=lower($5) limit 1`,
      [r.state_code,r.county,r.scope,r.role_key,r.full_name]
    ) as any[];
    if (existing[0]?.id) {
      await sql.query(
        `update raven_state_contacts set title=$2,email=$3,phone=$4,source_url=$5,verification_status='verified',verified_at=now(),evidence_note=$6,updated_at=now() where id=$1`,
        [existing[0].id,r.title,r.email,r.phone,r.source_url,r.evidence_note]
      );
    } else {
      await sql.query(
        `insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values($1,$2,null,$3,$4,$5,$6,$7,$8,$9,'verified',now(),$10)`,
        [r.state_code,r.county,r.scope,r.role_key,r.full_name,r.title,r.email,r.phone,r.source_url,r.evidence_note]
      );
    }
  }

  await sql.query(`delete from raven_state_contacts m where m.state_code='AL' and m.county='Barbour' and m.verification_status='missing' and m.full_name is null and m.role_key in ('superintendent','it_director') and exists(select 1 from raven_state_contacts v where v.state_code=m.state_code and v.county=m.county and v.role_key=m.role_key and v.verification_status='verified')`);

  const totals = await sql.query(`select count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*)::int total from raven_state_contacts where state_code='AL'`) as any[];
  console.log('RAVEN_ALABAMA_PROGRESS', JSON.stringify(totals[0] || {}));
  return NextResponse.json({ok:true,state:'AL',progress:totals[0] || {}});
}
