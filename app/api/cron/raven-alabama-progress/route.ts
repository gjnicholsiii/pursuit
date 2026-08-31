import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const records = [
  {
    county: "Blount",
    role_key: "security_director",
    full_name: "Meagan Holt",
    title: "Federal Programs Coordinator, EL/Migrant Coordinator, Safety Coordinator",
    email: "mholt@blountboe.net",
    phone: "205-775-1950",
    source_url: "https://www.blountboe.net/departments/federal-programs",
    evidence_note: "Official Blount County Schools page lists Meagan Holt as Safety Coordinator; district directory supplies email and district phone."
  },
  {
    county: "Blount",
    role_key: "school_board",
    full_name: "Chris Latta",
    title: "Board Member, President, District V",
    email: null,
    phone: "205-775-1950",
    source_url: "https://www.blountboe.net/about-us/school-board",
    evidence_note: "Official Blount County Schools board page lists Chris Latta as Board President; page supplies district phone."
  },
  {
    county: "Blount",
    role_key: "superintendent",
    full_name: "Rodney Green",
    title: "Superintendent",
    email: "rgreen@blountboe.net",
    phone: "205-775-1950",
    source_url: "https://www.blountboe.net/about-us/superintendent",
    evidence_note: "Official Blount County Schools superintendent page and directory."
  },
  {
    county: "Blount",
    role_key: "assistant_superintendent",
    full_name: "Christopher Lakey",
    title: "Assistant Superintendent",
    email: "clakey@blountboe.net",
    phone: "205-775-1950",
    source_url: "https://www.blountboe.net/link-3",
    evidence_note: "Official Blount County Schools staff directory."
  },
  {
    county: "Blount",
    role_key: "it_director",
    full_name: "Brad Williams",
    title: "Technology Director",
    email: "bdwilliams@blountboe.net",
    phone: "205-775-1950",
    source_url: "https://www.blountboe.net/departments/technology",
    evidence_note: "Official Blount County Schools technology page."
  }
] as const;

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  for (const r of records) {
    const agencies = await sql.query(`select id from agencies where agency_type='k12' and state_code='AL' and lower(coalesce(county,''))=lower($1) and (canonical_name ilike '%County%' or jurisdiction_level='county') order by case when canonical_name ilike '%Blount County%' then 0 else 1 end, id limit 1`, [r.county]) as any[];
    const agencyId = agencies[0]?.id ?? null;
    const updated = await sql.query(`update raven_state_contacts set full_name=$1,title=$2,email=$3,phone=$4,source_url=$5,verification_status='verified',verified_at=now(),evidence_note=$6,updated_at=now() where state_code='AL' and lower(coalesce(county,''))=lower($7) and role_key=$8 and verification_status in ('missing','candidate') returning id`, [r.full_name,r.title,r.email,r.phone,r.source_url,r.evidence_note,r.county,r.role_key]) as any[];
    if (!updated.length) {
      await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values('AL',$1,$2,'district',$3,$4,$5,$6,$7,$8,'verified',now(),$9)`, [r.county,agencyId,r.role_key,r.full_name,r.title,r.email,r.phone,r.source_url,r.evidence_note]);
    }
  }

  const counts = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing from raven_state_contacts where state_code='AL'`) as any[];
  console.log('RAVEN_AL_PROGRESS', JSON.stringify(counts[0] || {}));
  return NextResponse.json({ok:true,state:'AL',counts:counts[0] || {}});
}
