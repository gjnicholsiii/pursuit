import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALSDE_DIRECTORY = "https://eddir.alsde.edu/SiteInfo/PublicPrivateReligiousSites";

function decode(s: string) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function countyRows(html: string) {
  const text = decode(html);
  const systems = [...text.matchAll(/\b([A-Z][A-Za-z.'’ -]+ County)\s+\1\s+Central Office\s+(.{2,120}?)\s+(\d{1,5}\s+[A-Za-z0-9.'’# -]{2,80}?)\s+([A-Za-z.'’ -]+)\s+AL\s+\d{5}(?:-\d{4})?\s+(\d{3}[.-]\d{3}[.-]\d{4})/g)];
  return systems.map(m => ({
    system: m[1].trim(),
    full_name: m[2].trim().replace(/\s+/g, " "),
    phone: m[5].replace(/\./g, "-"),
  })).filter(r => !/Central Office|County/i.test(r.full_name));
}

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  const response = await fetch(ALSDE_DIRECTORY, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 Raven/1.0" } });
  if (!response.ok) return NextResponse.json({ ok:false, error:`ALSDE directory ${response.status}` }, { status: 502 });
  const html = await response.text();
  const rows = countyRows(html);
  let verified = 0;

  for (const row of rows) {
    const agencies = await sql.query(`select id::text,county from agencies where agency_type='k12' and state_code='AL' and lower(canonical_name)=lower($1) order by id limit 1`, [row.system]) as any[];
    if (!agencies[0]) continue;
    const agencyId = agencies[0].id;
    const county = agencies[0].county || row.system.replace(/ County$/i, '');
    const existing = await sql.query(`select id::text from raven_state_contacts where state_code='AL' and agency_id=$1 and role_key='superintendent' order by case verification_status when 'verified' then 0 when 'candidate' then 1 else 2 end,id limit 1`, [agencyId]) as any[];
    if (existing[0]) {
      await sql.query(`update raven_state_contacts set county=$2,scope='district',full_name=$3,title='Superintendent',phone=$4,source_url=$5,verification_status='verified',verified_at=now(),evidence_note='Current Alabama State Department of Education Education Directory central-office listing',updated_at=now() where id=$1`, [existing[0].id,county,row.full_name,row.phone,ALSDE_DIRECTORY]);
    } else {
      await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,phone,source_url,verification_status,verified_at,evidence_note) values('AL',$1,$2,'district','superintendent',$3,'Superintendent',$4,$5,'verified',now(),'Current Alabama State Department of Education Education Directory central-office listing')`, [county,agencyId,row.full_name,row.phone,ALSDE_DIRECTORY]);
    }
    verified++;
  }

  // State-level school-safety lead: retain as candidate until a current ALSDE staff page reconfirms the individual.
  const stateSlot = await sql.query(`select id::text from raven_state_contacts where state_code='AL' and scope='state' and role_key='state_security_director' order by id limit 1`) as any[];
  if (stateSlot[0]) {
    await sql.query(`update raven_state_contacts set full_name=coalesce(full_name,'Ayanna Long'),title=coalesce(title,'Education Administrator - School Safety'),phone=coalesce(phone,'334-694-4717'),email=coalesce(email,'along@alsde.edu'),source_url=coalesce(source_url,'https://www.alabamaachieves.org/wp-content/uploads/2024/01/COMM_20240112_DAPS-2024_V1.0.pdf'),verification_status=case when verification_status='verified' then 'verified' else 'candidate' end,evidence_note=coalesce(evidence_note,'ALSDE School Safety section; current reconfirmation pending'),updated_at=now() where id=$1`, [stateSlot[0].id]);
  }

  const summary = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(distinct county)::int counties from raven_state_contacts where state_code='AL'`) as any[];
  console.log('RAVEN_AL_BUILD', JSON.stringify({directoryRows:rows.length,superintendentsVerified:verified,summary:summary[0]}));
  return NextResponse.json({ok:true,directoryRows:rows.length,superintendentsVerified:verified,summary:summary[0]});
}
