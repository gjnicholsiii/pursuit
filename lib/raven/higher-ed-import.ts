import { getSql } from "@/lib/db";

type UrbanRecord = Record<string, unknown>;
type HigherEdRecord = { name:string; state:string; city:string|null; website:string|null; unitId:string|null };

type ImportResult = {
  fetched: number;
  accepted: number;
  inserted: number;
  updated: number;
  skipped: number;
  pages: number;
  totalReported: number | null;
  complete: boolean;
};

const ENDPOINT = "https://educationdata.urban.org/api/v1/college-university/ipeds/directory/2024/?per_page=1000";

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
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(candidate);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

function looksActive(row: UrbanRecord) {
  const status = text(row, "institution_status", "status", "active", "inst_status").toLowerCase();
  if (!status) return true;
  return !/(closed|inactive|out of business|deleted)/i.test(status);
}

function pickRecord(row: UrbanRecord): HigherEdRecord | null {
  const name = text(row, "institution_name", "inst_name", "instnm", "name");
  const state = text(row, "state_abbr", "state", "stabbr").toUpperCase().slice(0, 2);
  if (!name || !/^[A-Z]{2}$/.test(state)) return null;
  return {
    name,
    state,
    city: text(row, "city", "city_name") || null,
    website: normalizeWebsite(text(row, "website", "url", "institution_url", "webaddr")),
    unitId: text(row, "unitid", "unit_id") || null,
  };
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "Pursuit-Raven/1.0" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`IPEDS proxy returned ${response.status}`);
    return await response.json() as { results?: UrbanRecord[]; next?: string | null; count?: number } | UrbanRecord[];
  } finally { clearTimeout(timer); }
}

async function persistBatch(records: HigherEdRecord[]) {
  if (!records.length) return { inserted:0, updated:0 };
  const sql = getSql();
  const payload = JSON.stringify(records);
  const result = await sql.query(`
    with incoming as (
      select distinct on (lower(name), state)
        name, state, city, website, unit_id
      from jsonb_to_recordset($1::jsonb) as x(name text,state text,city text,website text,unit_id text)
      order by lower(name), state, unit_id nulls last
    ), updated as (
      update agencies a
      set city=coalesce(i.city,a.city),
          website=coalesce(i.website,a.website)
      from incoming i
      where a.agency_type='higher_ed'
        and lower(a.canonical_name)=lower(i.name)
        and coalesce(a.state_code,'')=i.state
      returning a.id
    ), inserted as (
      insert into agencies(canonical_name,agency_type,jurisdiction_level,state_code,city,website)
      select i.name,'higher_ed','institution',i.state,i.city,i.website
      from incoming i
      where not exists (
        select 1 from agencies a
        where a.agency_type='higher_ed'
          and lower(a.canonical_name)=lower(i.name)
          and coalesce(a.state_code,'')=i.state
      )
      returning id
    )
    select (select count(*) from inserted)::int inserted,
           (select count(*) from updated)::int updated
  `,[payload]) as Array<{inserted:number;updated:number}>;
  return result[0] || { inserted:0, updated:0 };
}

export async function importHigherEdUniverse(maxPages = 10): Promise<ImportResult> {
  let url: string | null = ENDPOINT;
  let pages = 0, fetched = 0, inserted = 0, updated = 0, skipped = 0;
  let totalReported: number | null = null;
  const accepted: HigherEdRecord[] = [];
  const pageLimit = Math.max(1, Math.min(maxPages, 20));

  while (url && pages < pageLimit) {
    const body = await fetchJson(url);
    const rows = Array.isArray(body) ? body : Array.isArray(body.results) ? body.results : [];
    const next = Array.isArray(body) ? null : body.next || null;
    if (!Array.isArray(body) && Number.isFinite(Number(body.count))) totalReported = Number(body.count);
    pages++;
    fetched += rows.length;

    for (const raw of rows) {
      if (!looksActive(raw)) { skipped++; continue; }
      const record = pickRecord(raw);
      if (!record) { skipped++; continue; }
      accepted.push(record);
    }
    url = next;
  }

  const unique = [...new Map(accepted.map(r => [`${r.state}:${r.name.toLowerCase()}`,r])).values()];
  for (let i=0;i<unique.length;i+=500) {
    const result = await persistBatch(unique.slice(i,i+500));
    inserted += Number(result.inserted || 0);
    updated += Number(result.updated || 0);
  }

  return {
    fetched,
    accepted: unique.length,
    inserted,
    updated,
    skipped,
    pages,
    totalReported,
    complete: !url && (totalReported===null || fetched>=totalReported),
  };
}
