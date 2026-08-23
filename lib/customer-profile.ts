import { cookies } from "next/headers";
import { getSql } from "@/lib/db";
import { decodeCustomerSession, encodeCustomerSession } from "@/lib/customer-session";
import type { Opportunity } from "@/lib/types";

const PROFILE_COOKIE = "pursuit_org_id";

export interface CustomerProfile {
  organizationId: string;
  organizationName: string;
  territories: string[];
  capabilityTerms: string[];
  naicsCodes: string[];
  pscCodes: string[];
  certifications: string[];
  smallBusinessStatuses: string[];
  minContractValue: number | null;
  maxContractValue: number | null;
}

type ProfileRow = {
  organization_id: string;
  organization_name: string;
  territories: string[] | null;
  capability_terms: string[] | null;
  naics_codes: string[] | null;
  certifications: string[] | null;
  small_business_statuses: string[] | null;
  min_contract_value: string | number | null;
  max_contract_value: string | number | null;
};

type MatchRow = {
  id: string;
  agency: string;
  agency_type: string;
  adapter_key: string;
  source_name: string;
  title: string;
  solicitation_type: string | null;
  due_at: string | null;
  estimated_value: string | number | null;
  state_code: string | null;
  city: string | null;
  naics_codes: string[] | null;
  set_aside: string | null;
  source_url: string;
  external_id: string | null;
  match_score: string | number;
  match_reasons: string[] | null;
  document_identified: string | number | null;
  document_fetched: string | number | null;
  document_analyzed: string | number | null;
  document_missing: string | number | null;
};

function decodeProfile(row: ProfileRow): CustomerProfile {
  const terms = row.capability_terms || [];
  return {
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    territories: row.territories || [],
    capabilityTerms: terms.filter(term => !term.startsWith("PSC:")),
    pscCodes: terms.filter(term => term.startsWith("PSC:")).map(term => term.slice(4)),
    naicsCodes: row.naics_codes || [],
    certifications: row.certifications || [],
    smallBusinessStatuses: row.small_business_statuses || [],
    minContractValue: row.min_contract_value == null ? null : Number(row.min_contract_value),
    maxContractValue: row.max_contract_value == null ? null : Number(row.max_contract_value),
  };
}

export async function getCurrentCustomerProfile(): Promise<CustomerProfile | null> {
  const cookieStore = await cookies();
  const organizationId = decodeCustomerSession(cookieStore.get(PROFILE_COOKIE)?.value);
  if (!organizationId) return null;

  const sql = getSql();
  const rows = await sql.query(
    `select
      o.id as organization_id,
      o.name as organization_name,
      sp.territories,
      sp.capability_terms,
      sp.naics_codes,
      sp.certifications,
      sp.small_business_statuses,
      sp.min_contract_value,
      sp.max_contract_value
    from organizations o
    join selling_profiles sp on sp.organization_id = o.id
    where o.id = $1
    order by sp.updated_at desc
    limit 1`,
    [organizationId],
  ) as ProfileRow[];

  return rows[0] ? decodeProfile(rows[0]) : null;
}

export async function saveCustomerProfile(input: {
  organizationName: string;
  territories: string[];
  capabilityTerms: string[];
  naicsCodes: string[];
  pscCodes: string[];
  certifications: string[];
  smallBusinessStatuses: string[];
  minContractValue: number | null;
  maxContractValue: number | null;
}) {
  const sql = getSql();
  const cookieStore = await cookies();
  const currentId = decodeCustomerSession(cookieStore.get(PROFILE_COOKIE)?.value);
  let organizationId = currentId || undefined;

  if (organizationId) {
    const existing = await sql.query(`select id from organizations where id = $1 limit 1`, [organizationId]) as Array<{ id: string }>;
    if (!existing[0]) organizationId = undefined;
  }

  if (!organizationId) {
    const created = await sql.query(`insert into organizations (name) values ($1) returning id`, [input.organizationName]) as Array<{ id: string }>;
    organizationId = created[0].id;
    cookieStore.set(PROFILE_COOKIE, encodeCustomerSession(organizationId), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  } else {
    await sql.query(`update organizations set name = $1 where id = $2`, [input.organizationName, organizationId]);
  }

  const storedTerms = [...input.capabilityTerms, ...input.pscCodes.map(code => `PSC:${code}`)];
  const existingProfile = await sql.query(`select id from selling_profiles where organization_id = $1 order by updated_at desc limit 1`, [organizationId]) as Array<{ id: string }>;

  if (existingProfile[0]) {
    await sql.query(
      `update selling_profiles set
        territories = $1,
        capability_terms = $2,
        naics_codes = $3,
        certifications = $4,
        small_business_statuses = $5,
        min_contract_value = $6,
        max_contract_value = $7,
        updated_at = now()
       where id = $8`,
      [input.territories, storedTerms, input.naicsCodes, input.certifications, input.smallBusinessStatuses, input.minContractValue, input.maxContractValue, existingProfile[0].id],
    );
  } else {
    await sql.query(
      `insert into selling_profiles
        (organization_id, territories, capability_terms, naics_codes, certifications, small_business_statuses, min_contract_value, max_contract_value)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [organizationId, input.territories, storedTerms, input.naicsCodes, input.certifications, input.smallBusinessStatuses, input.minContractValue, input.maxContractValue],
    );
  }

  return organizationId;
}

function displayDate(value: string | null) {
  if (!value) return "Not stated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not stated";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function confidence(row: MatchRow) {
  let score = row.adapter_key === "sam_gov" ? 38 : 42;
  if (row.due_at) score += 10;
  if (row.external_id) score += 7;
  if (row.naics_codes?.length) score += 5;
  if (row.set_aside) score += 5;
  if (row.city || row.state_code) score += 5;
  if (Number(row.document_identified || 0) > 0) score += 7;
  return Math.min(score, 78);
}

function uncertainty(row: MatchRow) {
  const identified = Number(row.document_identified || 0);
  const fetched = Number(row.document_fetched || 0);
  const analyzed = Number(row.document_analyzed || 0);
  const missing = Number(row.document_missing || 0);
  if (identified === 0) return "No bid-package documents have been identified in Pursuit yet.";
  if (missing > 0) return `${missing} identified package document${missing === 1 ? " is" : "s are"} marked missing.`;
  if (fetched < identified) return `${identified - fetched} identified package document${identified - fetched === 1 ? " is" : "s are"} still awaiting acquisition.`;
  if (analyzed < fetched) return `${fetched - analyzed} fetched package document${fetched - analyzed === 1 ? " is" : "s are"} still awaiting analysis.`;
  return "All currently identified package documents have been analyzed; package completeness still needs source confirmation.";
}

function toOpportunity(row: MatchRow): Opportunity {
  const federal = row.adapter_key === "sam_gov";
  const verified: string[] = [];
  if (row.due_at) verified.push(`Response deadline published by ${federal ? "SAM.gov" : row.source_name}`);
  if (row.external_id) verified.push(`Solicitation ${row.external_id}`);
  if (row.naics_codes?.[0]) verified.push(`NAICS ${row.naics_codes[0]}`);
  if (row.set_aside) verified.push(`Set-aside: ${row.set_aside}`);

  return {
    id: row.id,
    agency: row.agency,
    title: row.title,
    location: row.city && row.state_code ? `${row.city}, ${row.state_code}` : row.city || row.state_code || "Location not stated",
    value: row.estimated_value == null ? null : Number(row.estimated_value),
    due: displayDate(row.due_at),
    confidence: confidence(row),
    matchScore: Math.round(Number(row.match_score || 0)),
    matchReasons: row.match_reasons || [],
    eligibility: "review",
    procurementPath: row.solicitation_type || (federal ? "Federal opportunity" : "SLED opportunity"),
    stage: "new",
    source: `${federal ? "SAM.gov" : row.source_name} stored in Pursuit`,
    sourceUrl: row.source_url,
    solicitationNumber: row.external_id || undefined,
    naicsCode: row.naics_codes?.[0],
    setAside: row.set_aside || undefined,
    tags: federal ? ["Federal", row.solicitation_type || "Opportunity"] : ["SLED", row.agency_type, row.solicitation_type || "Opportunity"],
    verified,
    uncertainty: [uncertainty(row)],
    nextStep: "Review the source record and available package intelligence before making a bid decision.",
  };
}

export async function getCustomerMatches(profile: CustomerProfile, options: { limit?: number; threshold?: number; query?: string; source?: "all" | "federal" | "sled"; state?: string } = {}) {
  const sql = getSql();
  const limit = Math.max(1, Math.min(options.limit || 50, 500));
  const threshold = Math.max(0, Math.min(options.threshold ?? 45, 100));
  const query = options.query?.trim() || "";
  const source = options.source || "all";
  const state = options.state || "";

  const rows = await sql.query(
    `with candidate as (
      select
        o.*,
        a.canonical_name as agency,
        a.agency_type,
        s.adapter_key,
        s.source_name,
        s.source_family,
        coalesce(o.raw_payload->>'classificationCode','') as psc_code,
        lower(coalesce(o.title,'') || ' ' || coalesce(o.description,'')) as search_text
      from opportunities o
      join agencies a on a.id = o.agency_id
      join sources s on s.id = o.source_id
      where o.status = 'open'
        and (o.due_at is null or o.due_at >= now())
        and (s.adapter_key = 'sam_gov' or s.source_family = 'sled')
        and ($9 = 'all' or ($9 = 'federal' and s.adapter_key = 'sam_gov') or ($9 = 'sled' and s.source_family = 'sled'))
        and ($10 = '' or o.state_code = $10)
        and ($11 = '' or lower(coalesce(o.title,'') || ' ' || coalesce(o.description,'') || ' ' || a.canonical_name || ' ' || coalesce(o.external_id,'') || ' ' || array_to_string(o.naics_codes,' ') || ' ' || coalesce(o.raw_payload->>'classificationCode','')) like '%' || lower($11) || '%')
    ), scored as (
      select c.*,
        ((
          case when cardinality($1::text[]) > 0 then 40 else 0 end +
          case when cardinality($2::text[]) > 0 then 25 else 0 end +
          case when cardinality($3::text[]) > 0 then 15 else 0 end +
          case when cardinality($4::text[]) > 0 and c.set_aside is not null then 10 else 0 end +
          case when ($5::numeric is not null or $6::numeric is not null) and c.estimated_value is not null then 10 else 0 end
        ))::numeric as possible_points,
        ((
          case when c.naics_codes && $1::text[] or c.psc_code = any($7::text[]) then 40 else 0 end +
          case when exists (select 1 from unnest($2::text[]) term where c.search_text like '%' || lower(term) || '%') then 25 else 0 end +
          case when cardinality($3::text[]) > 0 and (c.state_code = any($3::text[]) or 'NATIONAL' = any($3::text[])) then 15 else 0 end +
          case when cardinality($4::text[]) > 0 and c.set_aside is not null and exists (select 1 from unnest($4::text[]) status where lower(c.set_aside) like '%' || lower(status) || '%') then 10 else 0 end +
          case when c.estimated_value is not null and ($5::numeric is null or c.estimated_value >= $5::numeric) and ($6::numeric is null or c.estimated_value <= $6::numeric) then 10 else 0 end
        ))::numeric as earned_points,
        array_remove(array[
          case when c.naics_codes && $1::text[] then 'NAICS match' when c.psc_code = any($7::text[]) then 'PSC match' end,
          case when exists (select 1 from unnest($2::text[]) term where c.search_text like '%' || lower(term) || '%') then 'Capability match' end,
          case when cardinality($3::text[]) > 0 and (c.state_code = any($3::text[]) or 'NATIONAL' = any($3::text[])) then coalesce(c.state_code,'National') || ' territory' end,
          case when cardinality($4::text[]) > 0 and c.set_aside is not null and exists (select 1 from unnest($4::text[]) status where lower(c.set_aside) like '%' || lower(status) || '%') then 'Set-aside fit' end,
          case when c.estimated_value is not null and ($5::numeric is not null or $6::numeric is not null) and ($5::numeric is null or c.estimated_value >= $5::numeric) and ($6::numeric is null or c.estimated_value <= $6::numeric) then 'Target contract range' end
        ], null) as match_reasons
      from candidate c
    ), ranked as (
      select scored.*, case when possible_points > 0 then round(100 * earned_points / possible_points) else 0 end as match_score
      from scored
    )
    select r.id, r.agency, r.agency_type, r.adapter_key, r.source_name, r.title, r.solicitation_type,
      r.due_at, r.estimated_value, r.state_code, r.city, r.naics_codes, r.set_aside, r.source_url, r.external_id,
      r.match_score, r.match_reasons,
      coalesce(ds.identified,0)::int as document_identified,
      coalesce(ds.fetched,0)::int as document_fetched,
      coalesce(ds.analyzed,0)::int as document_analyzed,
      coalesce(ds.missing,0)::int as document_missing
    from ranked r
    left join (
      select opportunity_id, count(*)::int as identified,
        count(*) filter (where fetched_at is not null)::int as fetched,
        count(*) filter (where extraction_status in ('complete','extracted','analyzed'))::int as analyzed,
        count(*) filter (where is_missing)::int as missing
      from opportunity_documents group by opportunity_id
    ) ds on ds.opportunity_id = r.id
    where r.match_score >= $8
    order by r.match_score desc, r.due_at asc nulls last, r.last_seen_at desc
    limit $12`,
    [profile.naicsCodes, profile.capabilityTerms, profile.territories, [...profile.certifications, ...profile.smallBusinessStatuses], profile.minContractValue, profile.maxContractValue, profile.pscCodes, threshold, source, state, query, limit],
  ) as MatchRow[];

  return rows.map(toOpportunity);
}
