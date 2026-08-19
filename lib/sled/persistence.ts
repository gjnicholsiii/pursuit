import { createHash } from "crypto";
import { getSql } from "@/lib/db";
import type { SledOpportunityRecord, SledPersistenceResult, SledSourceConfig } from "@/lib/sled/types";

function hashPayload(payload: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function sourceIdForAdapter(adapterKey: string) {
  const hex = createHash("sha256").update(`pursuit:sled:${adapterKey}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
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

function normalizedState(value?: string | null) {
  const state = value?.trim().toUpperCase();
  return state && state.length === 2 ? state : null;
}

function snapshot(record: SledOpportunityRecord | Record<string, unknown>) {
  const raw = "externalId" in record ? record as SledOpportunityRecord : null;
  if (raw) {
    return {
      title: raw.title,
      status: raw.status,
      dueAt: raw.dueAt || null,
      prebidAt: raw.prebidAt || null,
      solicitationType: raw.solicitationType || null,
    };
  }
  return record;
}

export async function persistSledOpportunities(
  source: SledSourceConfig,
  opportunities: SledOpportunityRecord[],
  options: { mode?: string; recordChanges?: boolean; closeMissing?: boolean } = {},
): Promise<SledPersistenceResult> {
  const sql = getSql();

  let sourceRows = await sql.query(
    `select id from sources where adapter_key = $1 order by created_at asc limit 1`,
    [source.adapterKey],
  ) as Array<{ id: string }>;

  if (!sourceRows.length) {
    const deterministicId = sourceIdForAdapter(source.adapterKey);
    sourceRows = await sql.query(
      `insert into sources
        (id, source_family, source_name, base_url, jurisdiction, source_type, adapter_key, active, health_score, last_success_at)
       values ($1::uuid, 'sled', $2, $3, $4, $5, $6, true, 100, now())
       on conflict (id) do update set
         source_name=excluded.source_name,
         base_url=excluded.base_url,
         jurisdiction=excluded.jurisdiction,
         source_type=excluded.source_type,
         adapter_key=excluded.adapter_key,
         active=true
       returning id`,
      [deterministicId, source.sourceName, source.baseUrl, source.jurisdiction || "United States", source.sourceType || "portal", source.adapterKey],
    ) as Array<{ id: string }>;
  } else {
    await sql.query(
      `update sources set source_name=$2, base_url=$3, jurisdiction=$4, source_type=$5, active=true
       where id=$1`,
      [sourceRows[0].id, source.sourceName, source.baseUrl, source.jurisdiction || "United States", source.sourceType || "portal"],
    );
  }

  const sourceId = sourceRows[0].id;
  const agencies = [...new Map(opportunities.map(item => [item.agency.key, item.agency])).values()];

  if (agencies.length) {
    await sql.query(
      `with incoming as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           agency_key text, canonical_name text, agency_type text, jurisdiction_level text,
           state_code text, city text, county text, website text
         )
       )
       insert into agencies (canonical_name, agency_type, jurisdiction_level, state_code, city, county, website)
       select canonical_name, agency_type, jurisdiction_level,
              case when length(state_code)=2 then state_code::char(2) else null end,
              city, county, website
       from incoming i
       where not exists (
         select 1 from agencies a
         where lower(a.canonical_name)=lower(i.canonical_name)
           and coalesce(a.state_code::text,'')=coalesce(i.state_code,'')
           and a.jurisdiction_level=i.jurisdiction_level
       )`,
      [JSON.stringify(agencies.map(a => ({
        agency_key: a.key,
        canonical_name: a.name,
        agency_type: a.agencyType,
        jurisdiction_level: a.jurisdictionLevel,
        state_code: normalizedState(a.stateCode),
        city: a.city || null,
        county: a.county || null,
        website: a.website || null,
      })))],
    );
  }

  const agencyNames = agencies.map(a => a.name);
  const agencyRows = agencyNames.length ? await sql.query(
    `select id, canonical_name, state_code, jurisdiction_level
     from agencies
     where canonical_name = any($1::text[])`,
    [agencyNames],
  ) as Array<{ id: string; canonical_name: string; state_code: string | null; jurisdiction_level: string }> : [];

  const agencyIds = new Map<string, string>();
  for (const agency of agencies) {
    const match = agencyRows.find(row =>
      row.canonical_name === agency.name &&
      (row.state_code || "") === (normalizedState(agency.stateCode) || "") &&
      row.jurisdiction_level === agency.jurisdictionLevel
    );
    if (match) agencyIds.set(agency.key, match.id);
  }

  const externalIds = opportunities.map(o => o.externalId);
  const existingRows = externalIds.length ? await sql.query(
    `select id, external_id, content_hash, raw_payload
     from opportunities
     where source_id=$1 and external_id=any($2::text[])`,
    [sourceId, externalIds],
  ) as Array<{ id: string; external_id: string; content_hash: string | null; raw_payload: Record<string, unknown> }> : [];
  const existing = new Map(existingRows.map(row => [row.external_id, row]));

  const records = opportunities.flatMap(item => {
    const agencyId = agencyIds.get(item.agency.key);
    if (!agencyId) return [];
    return [{
      external_id: item.externalId,
      agency_id: agencyId,
      title: item.title,
      description: item.description || null,
      solicitation_type: item.solicitationType || null,
      procurement_mechanism: item.procurementMechanism || null,
      status: item.status,
      issue_date: safeDate(item.issueDate),
      due_at: safeTimestamp(item.dueAt),
      prebid_at: safeTimestamp(item.prebidAt),
      estimated_value: item.estimatedValue ?? null,
      state_code: normalizedState(item.stateCode || item.agency.stateCode),
      city: item.city || item.agency.city || null,
      naics_codes: item.naicsCodes || [],
      set_aside: item.setAside || null,
      source_url: item.sourceUrl,
      content_hash: hashPayload(item.rawPayload),
      raw_payload: item.rawPayload,
    }];
  });

  const changed = options.recordChanges === false ? [] : records.flatMap(record => {
    const before = existing.get(record.external_id);
    if (!before || before.content_hash === record.content_hash) return [];
    return [{ externalId: record.external_id, before: before.raw_payload, after: record.raw_payload }];
  });

  if (records.length) {
    await sql.query(
      `with incoming as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           external_id text, agency_id uuid, title text, description text,
           solicitation_type text, procurement_mechanism text, status text,
           issue_date date, due_at timestamptz, prebid_at timestamptz,
           estimated_value numeric, state_code text, city text, naics_codes text[],
           set_aside text, source_url text, content_hash text, raw_payload jsonb
         )
       )
       insert into opportunities (
         agency_id, source_id, external_id, title, description, solicitation_type,
         procurement_mechanism, status, issue_date, due_at, prebid_at, estimated_value,
         state_code, city, naics_codes, set_aside, source_url, last_seen_at, content_hash, raw_payload
       )
       select agency_id, $2::uuid, external_id, title, description, solicitation_type,
              procurement_mechanism, status, issue_date, due_at, prebid_at, estimated_value,
              case when length(state_code)=2 then state_code::char(2) else null end,
              city, naics_codes, set_aside, source_url, now(), content_hash, raw_payload
       from incoming
       on conflict (source_id, external_id) do update set
         agency_id=excluded.agency_id,
         title=excluded.title,
         description=excluded.description,
         solicitation_type=excluded.solicitation_type,
         procurement_mechanism=excluded.procurement_mechanism,
         status=excluded.status,
         issue_date=excluded.issue_date,
         due_at=excluded.due_at,
         prebid_at=excluded.prebid_at,
         estimated_value=excluded.estimated_value,
         state_code=excluded.state_code,
         city=excluded.city,
         naics_codes=excluded.naics_codes,
         set_aside=excluded.set_aside,
         source_url=excluded.source_url,
         last_seen_at=now(),
         content_hash=excluded.content_hash,
         raw_payload=excluded.raw_payload`,
      [JSON.stringify(records), sourceId],
    );
  }

  if (changed.length) {
    const changedIds = changed.map(item => item.externalId);
    const opportunityRows = await sql.query(
      `select id, external_id from opportunities where source_id=$1 and external_id=any($2::text[])`,
      [sourceId, changedIds],
    ) as Array<{ id: string; external_id: string }>;
    const ids = new Map(opportunityRows.map(row => [row.external_id, row.id]));
    const rows = changed.flatMap(item => {
      const opportunityId = ids.get(item.externalId);
      if (!opportunityId) return [];
      return [{
        opportunity_id: opportunityId,
        change_type: "source_update",
        summary: `${source.sourceName} record changed`,
        before_value: snapshot(item.before),
        after_value: snapshot(item.after),
        evidence: { source: source.sourceName, externalId: item.externalId },
      }];
    });
    if (rows.length) {
      await sql.query(
        `with incoming as (
           select * from jsonb_to_recordset($1::jsonb) as x(
             opportunity_id uuid, change_type text, summary text,
             before_value jsonb, after_value jsonb, evidence jsonb
           )
         )
         insert into opportunity_changes (opportunity_id, change_type, summary, before_value, after_value, evidence)
         select opportunity_id, change_type, summary, before_value, after_value, evidence from incoming`,
        [JSON.stringify(rows)],
      );
    }
  }

  let closedRows: Array<{ id: string; external_id: string }> = [];
  if (options.closeMissing) {
    closedRows = await sql.query(
      `select id, external_id
       from opportunities
       where source_id=$1
         and status='open'
         and external_id is not null
         and not (external_id = any($2::text[]))`,
      [sourceId, externalIds],
    ) as Array<{ id: string; external_id: string }>;

    if (closedRows.length) {
      const ids = closedRows.map(row => row.id);
      await sql.query(
        `update opportunities set status='closed' where id=any($1::uuid[])`,
        [ids],
      );

      if (options.recordChanges !== false) {
        await sql.query(
          `with incoming as (
             select * from jsonb_to_recordset($1::jsonb) as x(
               opportunity_id uuid, change_type text, summary text,
               before_value jsonb, after_value jsonb, evidence jsonb
             )
           )
           insert into opportunity_changes (opportunity_id, change_type, summary, before_value, after_value, evidence)
           select opportunity_id, change_type, summary, before_value, after_value, evidence from incoming`,
          [JSON.stringify(closedRows.map(row => ({
            opportunity_id: row.id,
            change_type: "source_closed",
            summary: `${source.sourceName} no longer lists this opportunity as open`,
            before_value: { status: "open" },
            after_value: { status: "closed" },
            evidence: { source: source.sourceName, externalId: row.external_id, completeSweep: true },
          })))],
        );
      }
    }
  }

  const newRecords = records.filter(record => !existing.has(record.external_id)).length;
  const totalChanged = changed.length + closedRows.length;
  await sql.query(
    `insert into source_runs
      (source_id, completed_at, status, records_seen, records_new, records_changed, diagnostics)
     values ($1, now(), 'success', $2, $3, $4, $5::jsonb)`,
    [sourceId, records.length, newRecords, totalChanged, JSON.stringify({
      adapter: source.adapterKey,
      mode: options.mode || "interactive",
      closeMissing: Boolean(options.closeMissing),
      closedRecords: closedRows.length,
    })],
  );
  await sql.query(`update sources set last_success_at=now(), last_error=null, health_score=100 where id=$1`, [sourceId]);

  return {
    stored: records.length,
    newRecords,
    changedRecords: changed.length,
    closedRecords: closedRows.length,
  };
}
