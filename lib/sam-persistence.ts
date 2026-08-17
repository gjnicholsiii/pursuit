import { createHash } from "crypto";
import { getSql } from "@/lib/db";
import type { SamOpportunityRaw } from "@/lib/sam";

export interface SamPersistenceResult {
  stored: number;
  newRecords: number;
  changedRecords: number;
}

function agencyName(raw: SamOpportunityRaw) {
  if (raw.fullParentPathName) {
    const parts = raw.fullParentPathName.split(".").filter(Boolean);
    return parts[parts.length - 1] || raw.fullParentPathName;
  }
  return raw.office || raw.subTier || raw.department || "Federal agency";
}

function safeDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function safeTimestamp(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function sourceUrl(raw: SamOpportunityRaw) {
  if (raw.uiLink) return raw.uiLink;
  if (raw.noticeId) return `https://sam.gov/workspace/contract/opp/${raw.noticeId}/view`;
  return "https://sam.gov/content/opportunities";
}

function hashPayload(raw: SamOpportunityRaw) {
  return createHash("sha256").update(JSON.stringify(raw)).digest("hex");
}

export async function persistSamOpportunities(rawOpportunities: SamOpportunityRaw[]): Promise<SamPersistenceResult> {
  const usable = rawOpportunities.filter(raw => raw.noticeId || raw.solicitationNumber);
  if (!usable.length) return { stored: 0, newRecords: 0, changedRecords: 0 };

  const sql = getSql();

  let sourceRows = await sql.query(
    `select id from sources where adapter_key = $1 order by created_at asc limit 1`,
    ["sam_gov"],
  ) as Array<{ id: string }>;

  if (!sourceRows.length) {
    sourceRows = await sql.query(
      `insert into sources
        (source_family, source_name, base_url, jurisdiction, source_type, adapter_key, active, health_score, last_success_at)
       values ($1, $2, $3, $4, $5, $6, true, 100, now())
       returning id`,
      ["federal", "SAM.gov Contract Opportunities", "https://sam.gov", "United States", "api", "sam_gov"],
    ) as Array<{ id: string }>;
  }

  const sourceId = sourceRows[0].id;
  const agencyNames = [...new Set(usable.map(agencyName))];

  await sql.query(
    `insert into agencies (canonical_name, agency_type, jurisdiction_level)
     select incoming.name, 'federal_agency', 'federal'
     from unnest($1::text[]) as incoming(name)
     where not exists (
       select 1 from agencies a
       where a.canonical_name = incoming.name and a.jurisdiction_level = 'federal'
     )`,
    [agencyNames],
  );

  const agencyRows = await sql.query(
    `select id, canonical_name
     from agencies
     where jurisdiction_level = 'federal' and canonical_name = any($1::text[])`,
    [agencyNames],
  ) as Array<{ id: string; canonical_name: string }>;
  const agencyIds = new Map(agencyRows.map(row => [row.canonical_name, row.id]));

  const externalIds = usable.map(raw => raw.noticeId || raw.solicitationNumber).filter((id): id is string => Boolean(id));
  const existingRows = await sql.query(
    `select external_id, content_hash
     from opportunities
     where source_id = $1 and external_id = any($2::text[])`,
    [sourceId, externalIds],
  ) as Array<{ external_id: string; content_hash: string | null }>;
  const existing = new Map(existingRows.map(row => [row.external_id, row.content_hash]));

  const records = usable.flatMap(raw => {
    const externalId = raw.noticeId || raw.solicitationNumber;
    const agencyId = agencyIds.get(agencyName(raw));
    if (!externalId || !agencyId) return [];

    const stateCode = raw.placeOfPerformance?.state?.code;
    return [{
      external_id: externalId,
      agency_id: agencyId,
      title: raw.title?.trim() || "Untitled federal opportunity",
      description: raw.description || null,
      solicitation_type: raw.type || raw.baseType || null,
      procurement_mechanism: raw.type || raw.baseType || null,
      status: raw.active === "No" ? "closed" : "open",
      issue_date: safeDate(raw.postedDate),
      due_at: safeTimestamp(raw.responseDeadLine),
      state_code: stateCode && stateCode.length === 2 ? stateCode : null,
      city: raw.placeOfPerformance?.city?.name || null,
      naics_codes: raw.naicsCode ? [raw.naicsCode] : [],
      set_aside: raw.typeOfSetAsideDescription || raw.typeOfSetAside || null,
      source_url: sourceUrl(raw),
      content_hash: hashPayload(raw),
      raw_payload: raw,
    }];
  });

  if (!records.length) return { stored: 0, newRecords: 0, changedRecords: 0 };

  await sql.query(
    `with incoming as (
       select * from jsonb_to_recordset($1::jsonb) as x(
         external_id text,
         agency_id uuid,
         title text,
         description text,
         solicitation_type text,
         procurement_mechanism text,
         status text,
         issue_date date,
         due_at timestamptz,
         state_code char(2),
         city text,
         naics_codes text[],
         set_aside text,
         source_url text,
         content_hash text,
         raw_payload jsonb
       )
     )
     insert into opportunities (
       agency_id, source_id, external_id, title, description, solicitation_type,
       procurement_mechanism, status, issue_date, due_at, state_code, city,
       naics_codes, set_aside, source_url, last_seen_at, content_hash, raw_payload
     )
     select
       agency_id, $2::uuid, external_id, title, description, solicitation_type,
       procurement_mechanism, status, issue_date, due_at, state_code, city,
       naics_codes, set_aside, source_url, now(), content_hash, raw_payload
     from incoming
     on conflict (source_id, external_id) do update set
       agency_id = excluded.agency_id,
       title = excluded.title,
       description = excluded.description,
       solicitation_type = excluded.solicitation_type,
       procurement_mechanism = excluded.procurement_mechanism,
       status = excluded.status,
       issue_date = excluded.issue_date,
       due_at = excluded.due_at,
       state_code = excluded.state_code,
       city = excluded.city,
       naics_codes = excluded.naics_codes,
       set_aside = excluded.set_aside,
       source_url = excluded.source_url,
       last_seen_at = now(),
       content_hash = excluded.content_hash,
       raw_payload = excluded.raw_payload`,
    [JSON.stringify(records), sourceId],
  );

  const newRecords = records.filter(record => !existing.has(record.external_id)).length;
  const changedRecords = records.filter(record => {
    const previousHash = existing.get(record.external_id);
    return previousHash !== undefined && previousHash !== record.content_hash;
  }).length;

  await sql.query(
    `insert into source_runs
      (source_id, completed_at, status, records_seen, records_new, records_changed, diagnostics)
     values ($1, now(), 'success', $2, $3, $4, $5::jsonb)`,
    [sourceId, records.length, newRecords, changedRecords, JSON.stringify({ adapter: "sam_gov", persisted: records.length })],
  );

  await sql.query(
    `update sources set last_success_at = now(), last_error = null, health_score = 100 where id = $1`,
    [sourceId],
  );

  return { stored: records.length, newRecords, changedRecords };
}
