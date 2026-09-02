import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE_URL = "https://applications.education.ky.gov/SDCI/District.aspx/1000";

function clean(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDistrict(value: string) {
  return clean(value)
    .toLowerCase()
    .replace(/\bschool district\b/g, "")
    .replace(/\bschools\b/g, "")
    .replace(/\bdistrict\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req); if (auth) return auth;
  const sql = getSql();
  const beforeRows = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let html = "";
  try {
    const res = await fetch(SOURCE_URL, {
      cache: "no-store", redirect: "follow", signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; Pursuit-Raven/4.1; authoritative-public-directory)", accept: "text/html,application/xhtml+xml" }
    });
    if (!res.ok) return NextResponse.json({ok:false,error:`Kentucky KDE SDCI HTTP ${res.status}`},{status:502});
    html = await res.text();
  } finally { clearTimeout(timer); }

  const $ = cheerio.load(html);
  const rows: Array<{district:string;fullName:string;phone:string}> = [];
  $("tr").each((_, element) => {
    const cells = $(element).find("th,td").map((__, cell) => clean($(cell).text())).get();
    if (cells.length < 5 || !/^\d{3}$/.test(cells[0] || "")) return;
    const district = clean(cells[1] || "");
    const fullName = clean(cells[2] || "").replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.)\s+/i, "");
    const phone = clean(cells.find(v => /\(?\d{3}\)?[^\d]*\d{3}[^\d]*\d{4}/.test(v)) || "");
    if (!district || !fullName || !phone) return;
    rows.push({district,fullName,phone});
  });

  let filled = 0;
  const matchedDistricts: string[] = [];
  const unmatchedDistricts: string[] = [];
  for (const row of rows) {
    const key = row.district.replace(/\s+County$/i, "").replace(/\s+Independent$/i, "").trim();
    const normalized = normalizeDistrict(row.district);
    const updated = await sql.query(`
      with target as (
        select c.id
        from raven_state_contacts c
        left join agencies a on a.id=c.agency_id
        where c.state_code='KY' and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing'
          and (
            lower(regexp_replace(coalesce(c.county,''),'[[:space:]]+county$','','i'))=lower($1)
            or lower(coalesce(a.canonical_name,''))=lower($2)
            or lower(coalesce(a.canonical_name,'')) like '%' || lower($1) || '%'
            or regexp_replace(lower(regexp_replace(regexp_replace(coalesce(a.canonical_name,''),'school district|schools|district','','gi'),'[^a-z0-9]+','','g')),'[^a-z0-9]+','','g')=$6
            or regexp_replace(lower(regexp_replace(regexp_replace(coalesce(c.county,''),'school district|schools|district','','gi'),'[^a-z0-9]+','','g')),'[^a-z0-9]+','','g')=$6
          )
        order by case when lower(coalesce(a.canonical_name,''))=lower($2) then 0 else 1 end
        limit 1
      )
      update raven_state_contacts c
      set full_name=$3,title='Superintendent',phone=$4,email=null,source_url=$5,
          verification_status='candidate',
          evidence_note='Reachable superintendent from Kentucky Department of Education SDCI statewide directory; direct district phone published by KDE; awaiting strict live revalidation.',
          updated_at=now()
      from target t where c.id=t.id returning c.id
    `,[key,row.district,row.fullName,row.phone,SOURCE_URL,normalized]) as any[];
    if (updated.length) { filled += updated.length; matchedDistricts.push(row.district); }
    else unmatchedDistricts.push(row.district);
  }

  const afterRows = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[];
  console.log("[raven-kentucky-authoritative]", JSON.stringify({fetched:rows.length,filled,unmatched:unmatchedDistricts.length,matchedDistricts,unmatchedSample:unmatchedDistricts.slice(0,20)}));
  return NextResponse.json({ok:true,source:SOURCE_URL,fetched:rows.length,newlyAttempted:matchedDistricts.length,filled,before:beforeRows[0],after:afterRows[0],matchedDistricts,unmatched:unmatchedDistricts.length,unmatchedSample:unmatchedDistricts.slice(0,20)});
}
