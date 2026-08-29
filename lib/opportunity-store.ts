import { getSql } from "@/lib/db";
import type { Opportunity } from "@/lib/types";

interface StoredOpportunityRow {
  id: string;
  agency: string;
  agency_type: string;
  adapter_key: string;
  source_name: string;
  title: string;
  description: string | null;
  solicitation_type: string | null;
  status: string;
  due_at: string | null;
  estimated_value: string | number | null;
  state_code: string | null;
  city: string | null;
  naics_codes: string[] | null;
  set_aside: string | null;
  source_url: string;
  raw_payload: Record<string, unknown> | null;
  document_identified: number | string | null;
  document_fetched: number | string | null;
  document_analyzed: number | string | null;
  document_missing: number | string | null;
}

export interface SledMarketCounts {
  k12: number;
  higherEd: number;
  state: number;
  local: number;
  authorities: number;
}

function displayDate(value: string | null) {
  if (!value) return "Not stated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not stated";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function rawProject(row: StoredOpportunityRow) {
  const value = row.raw_payload?.project;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function solicitationNumberFor(row: StoredOpportunityRow) {
  if (row.adapter_key === "sam_gov") {
    const value = row.raw_payload?.solicitationNumber;
    return typeof value === "string" ? value : undefined;
  }
  const value = rawProject(row).financialId;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function documentState(row: StoredOpportunityRow) {
  return {
    identified: Number(row.document_identified || 0),
    fetched: Number(row.document_fetched || 0),
    analyzed: Number(row.document_analyzed || 0),
    missing: Number(row.document_missing || 0),
  };
}

function packageUncertainty(row: StoredOpportunityRow) {
  const state = documentState(row);

  if (state.identified === 0) {
    return "No bid-package documents have been identified in Pursuit yet.";
  }
  if (state.missing > 0) {
    return `${state.missing} of ${state.identified} identified package document${state.identified === 1 ? "" : "s"} ${state.missing === 1 ? "is" : "are"} marked missing.`;
  }
  if (state.fetched < state.identified) {
    const waiting = state.identified - state.fetched;
    return `${waiting} of ${state.identified} identified package document${state.identified === 1 ? "" : "s"} ${waiting === 1 ? "has" : "have"} not yet been fetched by Pursuit.`;
  }
  if (state.analyzed < state.fetched) {
    const waiting = state.fetched - state.analyzed;
    return `${waiting} of ${state.fetched} fetched package document${state.fetched === 1 ? "" : "s"} ${waiting === 1 ? "has" : "have"} not yet been analyzed.`;
  }
  return "All currently identified package documents have been analyzed; package completeness is not yet verified.";
}

function packageNextStep(row: StoredOpportunityRow) {
  const state = documentState(row);

  if (state.identified === 0) return "Open the original source and locate the bid package or solicitation documents.";
  if (state.missing > 0) return "Resolve the missing package documents before making a Pursue / Watch / Walk decision.";
  if (state.fetched < state.identified) return "Acquire the remaining identified package documents.";
  if (state.analyzed < state.fetched) return "Analyze the remaining fetched package documents.";
  return "Review verified requirements and confirm package completeness before deciding Pursue / Watch / Walk.";
}

function confidenceFor(row: StoredOpportunityRow) {
  const raw = row.raw_payload || {};
  const resources = Array.isArray(raw.resourceLinks) ? raw.resourceLinks : [];
  const project = rawProject(row);
  let score = row.adapter_key === "sam_gov" ? 38 : 42;
  if (row.due_at) score += 10;
  if (solicitationNumberFor(row)) score += 7;
  if (row.naics_codes?.length) score += 5;
  if (row.set_aside) score += 5;
  if (row.city || row.state_code) score += 5;
  if (resources.length) score += 7;
  if (row.description) score += 4;
  if (project.preProposalDate) score += 4;
  if (project.qaDeadline) score += 3;
  return Math.min(score, 78);
}

function mapFederal(row: StoredOpportunityRow): Opportunity {
  const raw = row.raw_payload || {};
  const resources = Array.isArray(raw.resourceLinks) ? raw.resourceLinks : [];
  const verified: string[] = [];
  const uncertainty: string[] = [];
  const solicitationNumber = solicitationNumberFor(row);
  const naicsCode = row.naics_codes?.[0];

  if (row.due_at) verified.push("Response deadline published by SAM.gov");
  else uncertainty.push("Response deadline not present in the stored SAM.gov record");
  if (row.set_aside) verified.push(`Set-aside: ${row.set_aside}`);
  else uncertainty.push("Set-aside status not stated in the stored feed record");
  if (naicsCode) verified.push(`NAICS ${naicsCode}`);
  else uncertainty.push("NAICS code not present in the stored feed record");
  if (resources.length) verified.push(`${resources.length} linked resource${resources.length === 1 ? "" : "s"} identified by SAM.gov`);
  uncertainty.push(packageUncertainty(row));

  return {
    id: row.id,
    agency: row.agency,
    title: row.title,
    location: row.city && row.state_code ? `${row.city}, ${row.state_code}` : row.city || row.state_code || "Location not stated",
    value: row.estimated_value === null ? null : Number(row.estimated_value),
    due: displayDate(row.due_at),
    confidence: confidenceFor(row),
    eligibility: "review",
    procurementPath: row.solicitation_type || "Federal opportunity",
    stage: "new",
    source: "SAM.gov stored in Pursuit",
    sourceUrl: row.source_url,
    solicitationNumber,
    naicsCode,
    setAside: row.set_aside || undefined,
    tags: ["Federal", row.solicitation_type || "Opportunity"],
    verified,
    uncertainty,
    nextStep: packageNextStep(row),
  };
}

function mapSled(row: StoredOpportunityRow): Opportunity {
  const project = rawProject(row);
  const verified: string[] = [];
  const uncertainty: string[] = [];
  const solicitationNumber = solicitationNumberFor(row);
  if (row.due_at) verified.push(`Response deadline published by ${row.source_name}`);
  else uncertainty.push("Response deadline is not stated in the public listing");
  if (solicitationNumber) verified.push(`Solicitation ${solicitationNumber}`);
  if (project.preProposalDate) verified.push("Pre-proposal date is published in the source record");
  if (project.qaDeadline) verified.push("Question deadline is published in the source record");
  uncertainty.push(packageUncertainty(row));

  return {
    id: row.id,
    agency: row.agency,
    title: row.title,
    location: row.city && row.state_code ? `${row.city}, ${row.state_code}` : row.city || row.state_code || "Location not stated",
    value: row.estimated_value === null ? null : Number(row.estimated_value),
    due: displayDate(row.due_at),
    confidence: confidenceFor(row),
    eligibility: "review",
    procurementPath: row.solicitation_type || "SLED opportunity",
    stage: "new",
    source: `${row.source_name} stored in Pursuit`,
    sourceUrl: row.source_url,
    solicitationNumber,
    tags: ["SLED", row.agency_type, row.solicitation_type || "Opportunity"],
    verified,
    uncertainty,
    nextStep: packageNextStep(row),
  };
}

const DOCUMENT_STATE_JOIN = `
  left join (
    select
      opportunity_id,
      count(*)::int as identified,
      count(*) filter (where fetched_at is not null)::int as fetched,
      count(*) filter (where extraction_status in ('complete', 'extracted', 'analyzed'))::int as analyzed,
      count(*) filter (where is_missing)::int as missing
    from opportunity_documents
    group by opportunity_id
  ) ds on ds.opportunity_id = o.id
`;

function selectSql(whereClause: string) {
  return `select
       o.id,
       a.canonical_name as agency,
       a.agency_type,
       s.adapter_key,
       s.source_name,
       o.title,
       o.description,
       o.solicitation_type,
       o.status,
       o.due_at,
       o.estimated_value,
       o.state_code,
       o.city,
       o.naics_codes,
       o.set_aside,
       o.source_url,
       o.raw_payload,
       coalesce(ds.identified, 0)::int as document_identified,
       coalesce(ds.fetched, 0)::int as document_fetched,
       coalesce(ds.analyzed, 0)::int as document_analyzed,
       coalesce(ds.missing, 0)::int as document_missing
     from opportunities o
     join agencies a on a.id = o.agency_id
     join sources s on s.id = o.source_id
     ${DOCUMENT_STATE_JOIN}
     where ${whereClause}
     order by o.due_at asc nulls last, o.last_seen_at desc
     limit $1`;
}

const CURRENT_FEDERAL_FILTER = `
  s.adapter_key = 'sam_gov'
  and o.status = 'open'
  and (o.due_at is null or o.due_at >= now())
`;

const CURRENT_SLED_FILTER = `
  s.source_family = 'sled'
  and o.status = 'open'
  and (o.due_at is null or o.due_at >= now())
  and not (lower(a.canonical_name) = 'sampleville' and lower(o.title) = 'pranjal testing crd')
`;

export async function getStoredFederalOpportunities(limit = 50): Promise<Opportunity[]> {
  const sql = getSql();
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));
  const rows = await sql.query(selectSql(CURRENT_FEDERAL_FILTER), [safeLimit]) as StoredOpportunityRow[];
  return rows.map(mapFederal);
}

export async function getStoredSledOpportunities(limit = 50): Promise<Opportunity[]> {
  const sql = getSql();
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));
  const rows = await sql.query(selectSql(CURRENT_SLED_FILTER), [safeLimit]) as StoredOpportunityRow[];
  return rows.map(mapSled);
}

export async function getStoredOpportunityById(id: string): Promise<Opportunity | null> {
  const sql = getSql();
  const rows = await sql.query(
    `select
       o.id,
       a.canonical_name as agency,
       a.agency_type,
       s.adapter_key,
       s.source_name,
       o.title,
       o.description,
       o.solicitation_type,
       o.status,
       o.due_at,
       o.estimated_value,
       o.state_code,
       o.city,
       o.naics_codes,
       o.set_aside,
       o.source_url,
       o.raw_payload,
       coalesce(ds.identified, 0)::int as document_identified,
       coalesce(ds.fetched, 0)::int as document_fetched,
       coalesce(ds.analyzed, 0)::int as document_analyzed,
       coalesce(ds.missing, 0)::int as document_missing
     from opportunities o
     join agencies a on a.id = o.agency_id
     join sources s on s.id = o.source_id
     ${DOCUMENT_STATE_JOIN}
     where o.id = $1
     limit 1`,
    [id],
  ) as StoredOpportunityRow[];

  const row = rows[0];
  if (!row) return null;
  return row.adapter_key === "sam_gov" ? mapFederal(row) : mapSled(row);
}

async function countWhere(filter: string, joinAgencies = false) {
  const sql = getSql();
  const rows = await sql.query(
    `select count(*)::int as count
     from opportunities o
     ${joinAgencies ? "join agencies a on a.id = o.agency_id" : ""}
     join sources s on s.id = o.source_id
     where ${filter}`,
  ) as Array<{ count: number }>;
  return rows[0]?.count || 0;
}

export async function getStoredFederalCount(): Promise<number> {
  return countWhere(CURRENT_FEDERAL_FILTER);
}

export async function getStoredSledCount(): Promise<number> {
  return countWhere(CURRENT_SLED_FILTER, true);
}

export async function getStoredSledMarketCounts(): Promise<SledMarketCounts> {
  const sql = getSql();
  const rows = await sql.query(
    `select
       count(*) filter (where a.agency_type = 'k12')::int as k12,
       count(*) filter (where a.agency_type = 'higher_ed')::int as higher_ed,
       count(*) filter (where a.agency_type = 'state_agency')::int as state,
       count(*) filter (where a.agency_type in ('municipal', 'municipality', 'county', 'local_agency'))::int as local,
       count(*) filter (where a.agency_type = 'authority')::int as authorities
     from opportunities o
     join agencies a on a.id = o.agency_id
     join sources s on s.id = o.source_id
     where ${CURRENT_SLED_FILTER}`,
  ) as Array<{ k12: number; higher_ed: number; state: number; local: number; authorities: number }>;

  const row = rows[0];
  return {
    k12: row?.k12 || 0,
    higherEd: row?.higher_ed || 0,
    state: row?.state || 0,
    local: row?.local || 0,
    authorities: row?.authorities || 0,
  };
}
