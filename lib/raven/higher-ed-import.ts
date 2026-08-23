import { getSql } from "@/lib/db";

type UrbanRecord = Record<string, unknown>;

type ImportResult = {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  pages: number;
};

const ENDPOINT = "https://educationdata.urban.org/api/v1/college-university/ipeds/directory/2024/";

function text(row: UrbanRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function normalizeWebsite(value: string) {
  if (!value) return null;
  try {
    const candidate = value.startsWith("http") ? value : `https://${value}`;
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function looksActive(row: UrbanRecord) {
  const status = text(row, "institution_status", "status", "active", "inst_status").toLowerCase();
  if (!status) return true;
  return !/(closed|inactive|out of business|deleted)/i.test(status);
}

function pickRecord(row: UrbanRecord) {
  const name = text(row, "institution_name", "inst_name", "instnm", "name");
  const state = text(row, "state_abbr", "state", "stabbr").toUpperCase().slice(0, 2);
  const city = text(row, "city", "city_name");
  const website = normalizeWebsite(text(row, "website", "url", "institution_url", "webaddr"));
  const unitId = text(row, "unitid", "unit_id");
  return { name, state, city, website, unitId };
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "Pursuit-Raven/1.0" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`IPEDS proxy returned ${response.status}`);
    return await response.json() as { results?: UrbanRecord[]; next?: string | null } | UrbanRecord[];
  } finally {
    clearTimeout(timer);
  }
}

export async function importHigherEdUniverse(maxPages = 2): Promise<ImportResult> {
  const sql = getSql();
  let url: string | null = ENDPOINT;
  let pages = 0;
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  while (url && pages < Math.max(1, Math.min(maxPages, 10))) {
    const body = await fetchJson(url);
    const rows = Array.isArray(body) ? body : Array.isArray(body.results) ? body.results : [];
    const next = Array.isArray(body) ? null : body.next || null;
    pages++;
    fetched += rows.length;

    for (const raw of rows) {
      if (!looksActive(raw)) { skipped++; continue; }
      const record = pickRecord(raw);
      if (!record.name || !record.state) { skipped++; continue; }

      const existing = await sql.query(`
        select id::text, website
        from agencies
        where agency_type='higher_ed'
          and lower(canonical_name)=lower($1)
          and coalesce(state_code,'')=$2
        order by created_at asc
        limit 1
      `, [record.name, record.state]);

      if (existing.length) {
        await sql.query(`
          update agencies
          set city=coalesce(nullif($2,''), city),
              website=case when $3::text is not null then $3 else website end
          where id=$1
        `, [existing[0].id, record.city || null, record.website]);
        updated++;
      } else {
        await sql.query(`
          insert into agencies (canonical_name, agency_type, jurisdiction_level, state_code, city, website)
          values ($1,'higher_ed','institution',$2,$3,$4)
        `, [record.name, record.state, record.city || null, record.website]);
        inserted++;
      }
    }

    url = next;
  }

  return { fetched, inserted, updated, skipped, pages };
}
