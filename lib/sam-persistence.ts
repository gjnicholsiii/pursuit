import { createHash } from "crypto";
import { getSql } from "@/lib/db";
import type { SamOpportunityRaw } from "@/lib/sam";

export interface SamPersistenceResult {
  stored: number;
  newRecords: number;
  changedRecords: number;
}

export interface SamPersistenceContext {
  mode?: string;
  offset?: number;
  totalRecords?: number;
  recordChanges?: boolean;
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

function compactRawPayload(raw: SamOpportunityRaw): SamOpportunityRaw {
  const { description: _description, ...rest } = raw;
  return rest;
}

function changeSnapshot(raw: SamOpportunityRaw | null | undefined) {
  if (!raw) return {};
  return {
    title: raw.title || null,
    solicitationNumber: raw.solicitationNumber || null,
    responseDeadLine: raw.responseDeadLine || null,
    active: raw.active || null,
    type: raw.type || raw.baseType || null,
    typeOfSetAside: raw.typeOfSetAsideDescription || raw.typeOfSetAside || null,
    naicsCode: raw.naicsCode || null,
    resourceLinks: raw.resourceLinks || [],
  };
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.keys(after).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function isCancelledTitle(title?: string | null) {
  const normalized = title?.toLowerCase() || "";
  return normalized.includes("cancelled") || normalized.includes("canceled");
}

export async function persistSamOpportunities(
  rawOpportunities: SamOpportunityRaw[],
  context: SamPersistenceContext = {},
): Promise<SamPersistenceResult> {
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
    `select id, external_id, content_hash, raw_payload
     from opportunities
     where source_id = $1 and external_id = any($2::text[])`,
    [sourceId, externalIds],
  ) as Array<{ id: string; external_id: string; content_hash: string | null; raw_payload: SamOpportunityRaw }>;
  const existing = new Map(existingRows.map(row => [row.external_id, row]));

  const records = usable.flatMap(raw => {
    const externalId = raw.noticeId || raw.solicitationNumber;
    const agencyId = agencyIds.get(agencyName(raw));
    if (!externalId || !agencyId) return [];

    const previous = existing.get(externalId);
    const previousLinks = previous?.raw_payload?.resourceLinks;
    const rawForStorage: SamOpportunityRaw = !raw.resourceLinks?.length && previousLinks?.length
      ? { ...raw, resourceLinks: previousLinks }
      : raw;
    const compactPayload = compactRawPayload(rawForStorage);

    const stateCode = rawForStorage.placeOfPerformance?.state?.code;
    return [{
      external_id: externalId,
      agency_id: agencyId,
      title: rawForStorage.title?.trim() || "Untitled federal opportunity",
      description: rawForStorage.description || null,
      solicitation_type: rawForStorage.type || rawForStorage.baseType || null,
      procurement_mechanism: rawForStorage.type || rawForStorage.baseType || null,
      status: rawForStorage.active === "No" || isCancelledTitle(rawForStorage.title) ? "closed" : "open",
      issue_date: safeDate(rawForStorage.postedDate),
      due_at: safeTimestamp(rawForStorage.responseDeadLine),
      state_code: stateCode && stateCode.length === 2 ? stateCode : null,
      city: rawForStorage.placeOfPerformance?.city?.name || null,
      naics_codes: rawForStorage.naicsCode ? [rawForStorage.naicsCode] : [],
      set_aside: rawForStorage.typeOfSetAsideDescription || rawForStorage.typeOfSetAside || null,
      source_url: sourceUrl(rawForStorage),
      content_hash: hashPayload(rawForStorage),
      raw_payload: compactPayload,
    }];
  });

  if (!records.length) return { stored: 0, newRecords: 0, changedRecords: 0 };

  const changed = context.recordChanges === false ? [] : records.flatMap(record => {
    const previous = existing.get(record.external_id);
    if (!previous || previous.content_hash === record.content_hash) return [];
    const before = changeSnapshot(previous.raw_payload);
    const after = changeSnapshot(record.raw_payload);
    const fields = changedFields(before, after);
    return [{ externalId: record.external_id, before, after, fields }];
  });

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

  if (changed.length) {
    const changedIds = changed.map(item => item.externalId);
    const opportunityRows = await sql.query(
      `select id, external_id from opportunities where source_id = $1 and external_id = any($2::text[])`,
      [sourceId, changedIds],
    ) as Array<{ id: string; external_id: string }>;
    const opportunityIds = new Map(opportunityRows.map(row => [row.external_id, row.id]));

    const changeRows = changed.flatMap(item => {
      const opportunityId = opportunityIds.get(item.externalId);
      if (!opportunityId) return [];
      return [{
        opportunity_id: opportunityId,
        change_type: "source_update",
        summary: item.fields.length ? `SAM.gov changed: ${item.fields.join(", ")}` : "SAM.gov record changed",
        before_value: item.before,
        after_value: item.after,
        evidence: { source: "SAM.gov", externalId: item.externalId },
      }];
    });

    if (changeRows.length) {
      await sql.query(
        `with incoming as (
           select * from jsonb_to_recordset($1::jsonb) as x(
             opportunity_id uuid,
             change_type text,
             summary text,
             before_value jsonb,
             after_value jsonb,
             evidence jsonb
           )
         )
         insert into opportunity_changes (opportunity_id, change_type, summary, before_value, after_value, evidence)
         select opportunity_id, change_type, summary, before_value, after_value, evidence from incoming`,
        [JSON.stringify(changeRows)],
      );
    }
  }

  const newRecords = records.filter(record => !existing.has(record.external_id)).length;
  const changedRecords = changed.length;

  await sql.query(
    `insert into source_runs
      (source_id, completed_at, status, records_seen, records_new, records_changed, diagnostics)
     values ($1, now(), 'success', $2, $3, $4, $5::jsonb)`,
    [sourceId, records.length, newRecords, changedRecords, JSON.stringify({
      adapter: "sam_gov",
      persisted: records.length,
      mode: context.mode || "interactive",
      offset: context.offset ?? 0,
      totalRecords: context.totalRecords ?? null,
      recordChanges: context.recordChanges !== false,
    })],
  );

  await sql.query(
    `update sources set last_success_at = now(), last_error = null, health_score = 100 where id = $1`,
    [sourceId],
  );

  return { stored: records.length, newRecords, changedRecords };
}
