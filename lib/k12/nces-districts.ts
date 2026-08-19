import { load } from "cheerio";
import { getSql } from "@/lib/db";

const NCES_BASE = "https://nces.ed.gov/ccd/districtsearch/district_list.asp";

export const STATE_FIPS: Record<string, string> = {
  AL:"01", AK:"02", AZ:"04", AR:"05", CA:"06", CO:"08", CT:"09", DE:"10", FL:"12", GA:"13",
  HI:"15", ID:"16", IL:"17", IN:"18", IA:"19", KS:"20", KY:"21", LA:"22", ME:"23", MD:"24",
  MA:"25", MI:"26", MN:"27", MS:"28", MO:"29", MT:"30", NE:"31", NV:"32", NH:"33", NJ:"34",
  NM:"35", NY:"36", NC:"37", ND:"38", OH:"39", OK:"40", OR:"41", PA:"42", RI:"44", SC:"45",
  SD:"46", TN:"47", TX:"48", UT:"49", VT:"50", VA:"51", WA:"53", WV:"54", WI:"55", WY:"56",
};

type DistrictRow = {
  ncesId: string;
  name: string;
  city: string | null;
  county: string | null;
  enrollment: number | null;
  schools: number | null;
  sourceUrl: string;
};

function text(v: unknown) { return String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
function parseNumber(v: string) { const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) ? n : null; }
function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

function pageUrl(fips: string, page: number) {
  const u = new URL(NCES_BASE);
  u.searchParams.set("Search", "1");
  u.searchParams.set("State", fips);
  if (page > 1) u.searchParams.set("DistrictPageNum", String(page));
  return u.toString();
}

async function fetchHtmlWithRetry(url: string, attempts = 4) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
          accept: "text/html,application/xhtml+xml",
        },
      });
      if (!response.ok) throw new Error(`NCES returned ${response.status}`);
      const html = await response.text();
      if (!html.includes("resultList") && !html.includes("Search Results:")) throw new Error("NCES returned unexpected HTML");
      return html;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }
  throw new Error(`NCES fetch failed after ${attempts} attempts for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function fetchPage(fips: string, page: number) {
  const url = pageUrl(fips, page);
  const html = await fetchHtmlWithRetry(url);
  const $ = load(html);
  const bodyText = text($("body").text());
  const total = Number(bodyText.match(/Search Results:\s*([\d,]+)/i)?.[1]?.replace(/,/g, "") || 0);
  const maxPages = Math.max(1, Math.ceil(total / 15));
  const rows: DistrictRow[] = [];

  $("div.resultRow").each((_, node) => {
    const cells = $(node).children("div");
    if (cells.length < 6) return;
    const anchor = $(cells[1]).find("a[href*='district_detail.asp']").first();
    const name = text(anchor.text());
    const href = anchor.attr("href") || "";
    const id = href.match(/[?&](?:ID2|DistrictID)=(\d+)/i)?.[1];
    if (!id || !name) return;
    const address = text($(cells[1]).find("span").first().text());
    const city = address.match(/,\s*([^,]+),\s*[A-Z]{2}\s+\d{5}/)?.[1]?.trim() || null;
    const countyText = text($(cells[3]).text());
    const county = /county$/i.test(countyText) ? countyText : null;
    const enrollment = parseNumber(text($(cells[4]).text()));
    const schools = parseNumber(text($(cells[5]).text()));
    rows.push({ ncesId:id, name, city, county, enrollment, schools, sourceUrl:new URL(href, url).toString() });
  });

  return { total, maxPages, rows:[...new Map(rows.map(r => [r.ncesId, r])).values()] };
}

export async function syncNcesDistrictState(stateCode: string) {
  const code = stateCode.toUpperCase();
  const fips = STATE_FIPS[code];
  if (!fips) throw new Error(`Unsupported state ${stateCode}`);
  const first = await fetchPage(fips, 1);
  const pages = [first];
  for (let page = 2; page <= first.maxPages; page++) pages.push(await fetchPage(fips, page));
  const rows = [...new Map(pages.flatMap(p => p.rows).map(r => [r.ncesId, r])).values()];
  if (first.total && rows.length !== first.total) throw new Error(`NCES ${code} reconciliation failed: expected ${first.total}, parsed ${rows.length}`);
  const sql = getSql();
  let inserted = 0;
  let existing = 0;
  for (const row of rows) {
    // NCES ID is the durable identity. Names are not unique across districts and can change.
    const foundByNcesId = await sql`
      select id from agencies
      where state_code=${code}
        and agency_type='k12'
        and website like ${`%${row.ncesId}%`}
      limit 1
    `;
    if (foundByNcesId.length) { existing++; continue; }

    // Preserve already-imported records where the source URL predates this identity fix,
    // but only when the name match is unambiguous within the state.
    const nameMatches = await sql`
      select id, website from agencies
      where state_code=${code} and agency_type='k12' and lower(canonical_name)=lower(${row.name})
      order by created_at asc
      limit 2
    `;
    if (nameMatches.length === 1 && !nameMatches[0].website) {
      await sql`update agencies set website=${row.sourceUrl}, city=coalesce(city,${row.city}), county=coalesce(county,${row.county}) where id=${nameMatches[0].id}`;
      existing++;
      continue;
    }

    await sql`
      insert into agencies (canonical_name, agency_type, jurisdiction_level, state_code, city, county, website)
      values (${row.name}, 'k12', 'local', ${code}, ${row.city}, ${row.county}, ${row.sourceUrl})
    `;
    inserted++;
  }
  return { stateCode:code, ncesTotal:first.total, rowsParsed:rows.length, pages:first.maxPages, inserted, existing };
}

export async function syncNcesDistrictBatch(states: string[]) {
  const results = [];
  for (const state of states) results.push(await syncNcesDistrictState(state));
  return results;
}
