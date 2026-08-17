import { getSql } from "@/lib/db";
import type { Opportunity } from "@/lib/types";

interface StoredOpportunityRow {
  id: string;
  agency: string;
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
}

function displayDate(value: string | null) {
  if (!value) return "Not stated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not stated";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function confidenceFor(row: StoredOpportunityRow) {
  const raw = row.raw_payload || {};
  const resources = Array.isArray(raw.resourceLinks) ? raw.resourceLinks : [];
  let score = 38;
  if (row.due_at) score += 8;
  if (raw.solicitationNumber) score += 6;
  if (row.naics_codes?.length) score += 6;
  if (row.set_aside) score += 6;
  if (row.city || row.state_code) score += 5;
  if (resources.length) score += 7;
  if (row.description) score += 4;
  return Math.min(score, 78);
}

function mapStoredOpportunity(row: StoredOpportunityRow): Opportunity {
  const raw = row.raw_payload || {};
  const resources = Array.isArray(raw.resourceLinks) ? raw.resourceLinks : [];
  const verified: string[] = [];
  const uncertainty: string[] = [];
  const solicitationNumber = typeof raw.solicitationNumber === "string" ? raw.solicitationNumber : undefined;
  const naicsCode = row.naics_codes?.[0];

  if (row.due_at) verified.push("Response deadline published by SAM.gov");
  else uncertainty.push("Response deadline not present in the stored SAM.gov record");

  if (row.set_aside) verified.push(`Set-aside: ${row.set_aside}`);
  else uncertainty.push("Set-aside status not stated in the stored feed record");

  if (naicsCode) verified.push(`NAICS ${naicsCode}`);
  else uncertainty.push("NAICS code not present in the stored feed record");

  if (resources.length) verified.push(`${resources.length} linked resource${resources.length === 1 ? "" : "s"} identified`);
  else uncertainty.push("Bid-package attachments have not yet been acquired by Pursuit");

  uncertainty.push("Full solicitation package has not yet been analyzed");

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
    nextStep: "Open the source package. Pursuit will raise confidence only after the solicitation and attachments are acquired and analyzed.",
  };
}

export async function getStoredFederalOpportunities(limit = 50): Promise<Opportunity[]> {
  const sql = getSql();
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));
  const rows = await sql.query(
    `select
       o.id,
       a.canonical_name as agency,
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
       o.raw_payload
     from opportunities o
     join agencies a on a.id = o.agency_id
     join sources s on s.id = o.source_id
     where s.adapter_key = 'sam_gov'
     order by o.due_at asc nulls last, o.last_seen_at desc
     limit $1`,
    [safeLimit],
  ) as StoredOpportunityRow[];

  return rows.map(mapStoredOpportunity);
}

export async function getStoredFederalCount(): Promise<number> {
  const sql = getSql();
  const rows = await sql.query(
    `select count(*)::int as count
     from opportunities o
     join sources s on s.id = o.source_id
     where s.adapter_key = 'sam_gov'`,
  ) as Array<{ count: number }>;
  return rows[0]?.count || 0;
}
