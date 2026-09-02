import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE_URL = "https://applications.education.ky.gov/SDCI/District.aspx/1000";
const EXPORT_URL = "https://applications.education.ky.gov/SDCI/Download.aspx?DCD=2703&d=true&qt=D";

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

function parseCsvLine(line: string) {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { out.push(clean(cur)); cur = ""; }
    else cur += ch;
  }
  out.push(clean(cur));
  return out;
}

type Row = { district:string; fullName:string; phone:string };

function parseCsv(text: string): Row[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map(v => v.toLowerCase());
  const districtIdx = header.findIndex(v => v === "district" || v.includes("district name"));
  const superintendentIdx = header.findIndex(v => v.includes("superintendent"));
  const phoneIdx = header.findIndex(v => v === "phone" || v.includes("phone"));
  if (districtIdx < 0 || superintendentIdx < 0 || phoneIdx < 0) return [];
  const rows: Row[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const district = clean(cells[districtIdx] || "");
    const fullName = clean(cells[superintendentIdx] || "").replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.)\s+/i, "");
    const phone = clean(cells[phoneIdx] || "");
    if (!district || !fullName || !/\(?\d{3}\)?[^\d]*\d{3}[^\d]*\d{4}/.test(phone)) continue;
    rows.push({district,fullName,phone});
  }
  return rows;
}

function parseHtml(html: string): Row[] {
  const $ = cheerio.load(html);
  const rows: Row[] = [];
  $("tr").each((_, element) => {
    const cells = $(element).find("th,td").map((__, cell) => clean($(cell).text())).get();
    if (cells.length < 5 || !/^\d{3}$/.test(cells[0] || "")) return;
    const district = clean(cells[1] || "");
    const fullName = clean(cells[2] || "").replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.)\s+/i, "");
    const phone = clean(cells.find(v => /\(?\d{3}\)?[^\d]*\d{3}[^\d]*\d{4}/.test(v)) || "");
    if (!district || !fullName || !phone) return;
    rows.push({district,fullName,phone});
  });
  return rows;
}

async function fetchText(url: string, accept: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      cache: "no-store", redirect: "follow", signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; Pursuit-Raven/4.2; authoritative-public-directory)", accept }
    });
    if (!res.ok) throw new Error(`KDE HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req); if (auth) return auth;
  const sql = getSql();
  const beforeRows = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[];

  let rows: Row[] = [];
  let source = EXPORT_URL;
  let exportError: string | null = null;
  try {
    rows = parseCsv(await fetchText(EXPORT_URL, "text/csv,text/plain,application/octet-stream,*/*"));
    if (rows.length < 100) throw new Error(`KDE export parsed only ${rows.length} rows`);
  } catch (error) {
    exportError = error instanceof Error ? error.message : String(error);
    source = PAGE_URL;
    rows = parseHtml(await fetchText(PAGE_URL, "text/html,application/xhtml+xml"));
  }

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
          evidence_note='Reachable superintendent from Kentucky Department of Education statewide directory; direct district phone published by KDE; awaiting strict live revalidation.',
          updated_at=now()
      from target t where c.id=t.id returning c.id
    `,[key,row.district,row.fullName,row.phone,source,normalized]) as any[];
    if (updated.length) { filled += updated.length; matchedDistricts.push(row.district); }
    else unmatchedDistricts.push(row.district);
  }

  const afterRows = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[];
  console.log("[raven-kentucky-authoritative]", JSON.stringify({source,exportError,fetched:rows.length,filled,unmatched:unmatchedDistricts.length,matchedDistricts,unmatchedSample:unmatchedDistricts.slice(0,20)}));
  return NextResponse.json({ok:true,source,exportError,fetched:rows.length,newlyAttempted:matchedDistricts.length,filled,before:beforeRows[0],after:afterRows[0],matchedDistricts,unmatched:unmatchedDistricts.length,unmatchedSample:unmatchedDistricts.slice(0,20)});
}
