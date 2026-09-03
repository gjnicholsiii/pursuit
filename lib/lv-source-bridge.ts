import { getSql } from "@/lib/db";
import type { SledOpportunityRecord } from "@/lib/sled/types";
import { classifyLowVoltage } from "@/lib/lv-classifier";
import { persistLVPursuit, persistLVSignal } from "@/lib/lv-persistence";

type Row = Record<string, unknown>;

const MATCH_PATTERN = "(access control|video surveillance|security camera|cctv|fire alarm|structured cabling|low voltage cabling|data cabling|fiber optic|fiber backbone|intercom|mass notification|audio visual|audiovisual|nurse call|distributed antenna|errcs|public safety das|card reader|paging system|digital signage|camera system|intrusion alarm)";

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function iso(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : [];
}

function isEarlyNotice(row: Row) {
  const type = `${text(row.solicitation_type)} ${text(row.procurement_mechanism)}`.toLowerCase();
  return /sources sought|source sought|presolicitation|pre-solicitation|request for information|\brfi\b|market research|synopsis/.test(type);
}

function toOpportunity(row: Row): SledOpportunityRecord {
  const state = text(row.state_code) || null;
  const city = text(row.city) || null;
  const adapter = text(row.adapter_key, "source");
  const rawExternalId = text(row.external_id, text(row.id));
  return {
    externalId: `${adapter}:${rawExternalId}`,
    agency: {
      key: `legacy:${text(row.agency_id, text(row.canonical_name))}`,
      name: text(row.canonical_name, "Public agency"),
      agencyType: text(row.agency_type, "public_agency"),
      jurisdictionLevel: text(row.jurisdiction_level, "public"),
      stateCode: state,
      city,
      website: text(row.website) || null,
    },
    title: text(row.title, "Low-voltage opportunity"),
    description: text(row.description) || null,
    solicitationType: text(row.solicitation_type) || null,
    procurementMechanism: text(row.procurement_mechanism) || null,
    status: "open",
    issueDate: iso(row.issue_date),
    dueAt: iso(row.due_at),
    prebidAt: iso(row.prebid_at),
    estimatedValue: numberValue(row.estimated_value),
    stateCode: state,
    city,
    naicsCodes: strings(row.naics_codes),
    setAside: text(row.set_aside) || null,
    sourceUrl: text(row.source_url),
    rawPayload: {
      promotedFrom: "current_pursuit_source_warehouse",
      sourceAdapter: adapter,
      sourceName: text(row.source_name),
      lastSeenAt: iso(row.last_seen_at),
      legacyPayload: row.raw_payload || {},
    },
  };
}

async function queryCandidates(limit: number, adapterKey?: string) {
  const sql = getSql();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const base = adapterKey
    ? await sql`
        select
          o.id, o.agency_id, o.external_id, o.title, o.description, o.solicitation_type,
          o.procurement_mechanism, o.issue_date, o.due_at, o.prebid_at, o.estimated_value,
          o.state_code, o.city, o.naics_codes, o.set_aside, o.source_url, o.last_seen_at, o.raw_payload,
          a.canonical_name, a.agency_type, a.jurisdiction_level, a.website,
          s.adapter_key, s.source_name
        from opportunities o
        join agencies a on a.id = o.agency_id
        join sources s on s.id = o.source_id
        where o.status = 'open'
          and o.last_seen_at >= now() - interval '36 hours'
          and (o.due_at is null or o.due_at >= now())
          and s.adapter_key = ${adapterKey}
          and lower(coalesce(o.title,'') || ' ' || coalesce(o.description,'')) ~ ${MATCH_PATTERN}
        order by o.last_seen_at desc, o.due_at asc nulls last
        limit ${safeLimit}
      `
    : await sql`
        select
          o.id, o.agency_id, o.external_id, o.title, o.description, o.solicitation_type,
          o.procurement_mechanism, o.issue_date, o.due_at, o.prebid_at, o.estimated_value,
          o.state_code, o.city, o.naics_codes, o.set_aside, o.source_url, o.last_seen_at, o.raw_payload,
          a.canonical_name, a.agency_type, a.jurisdiction_level, a.website,
          s.adapter_key, s.source_name
        from opportunities o
        join agencies a on a.id = o.agency_id
        join sources s on s.id = o.source_id
        where o.status = 'open'
          and o.last_seen_at >= now() - interval '36 hours'
          and (o.due_at is null or o.due_at >= now())
          and lower(coalesce(o.title,'') || ' ' || coalesce(o.description,'')) ~ ${MATCH_PATTERN}
        order by o.last_seen_at desc, o.due_at asc nulls last
        limit ${safeLimit}
      `;
  return base as Row[];
}

export async function promoteCurrentLV(limit = 40, adapterKey?: string) {
  const candidates = await queryCandidates(limit, adapterKey);
  let accepted = 0;
  let rejected = 0;
  let storedPursuits = 0;
  let storedSignals = 0;
  let existing = 0;
  const sample: Array<Record<string, unknown>> = [];

  for (const row of candidates) {
    const opportunity = toOpportunity(row);
    if (!opportunity.sourceUrl) {
      rejected += 1;
      continue;
    }
    const classification = classifyLowVoltage({
      title: opportunity.title,
      description: opportunity.description,
      scope: [opportunity.solicitationType, opportunity.procurementMechanism, ...(opportunity.naicsCodes || [])].filter(Boolean).join(" "),
    });
    if (!classification.accepted) {
      rejected += 1;
      continue;
    }

    accepted += 1;
    const early = isEarlyNotice(row);
    const persisted = early
      ? await persistLVSignal(opportunity, classification, "planning_mention")
      : await persistLVPursuit(opportunity, classification);

    if (persisted.stored) {
      if (early) storedSignals += 1;
      else storedPursuits += 1;
    } else if (persisted.reason === "already_exists") {
      existing += 1;
    }

    if (sample.length < 20) {
      sample.push({
        source: text(row.adapter_key),
        agency: opportunity.agency.name,
        title: opportunity.title,
        dueAt: opportunity.dueAt,
        early,
        score: classification.score,
        disciplines: classification.disciplines,
        manufacturers: classification.manufacturers,
        stored: persisted.stored,
      });
    }
  }

  return {
    adapterKey: adapterKey || "all-current-sources",
    scanned: candidates.length,
    accepted,
    rejected,
    storedPursuits,
    storedSignals,
    existing,
    sample,
  };
}
