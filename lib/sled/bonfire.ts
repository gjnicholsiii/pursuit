import { getSql } from "@/lib/db";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const SOURCE: SledSourceConfig = {
  adapterKey: "bonfire_public",
  sourceName: "Euna Bonfire Public Procurement Network",
  baseUrl: "https://bonfirehub.com",
  jurisdiction: "United States",
  sourceType: "portal",
};

export interface BonfirePortalConfig {
  slug: string;
  agencyName: string;
  agencyType: string;
  jurisdictionLevel: string;
  stateCode: string;
  city?: string | null;
}

export const VERIFIED_BONFIRE_PORTALS: BonfirePortalConfig[] = [
  { slug: "env-nm", agencyName: "New Mexico Environment Department", agencyType: "state_agency", jurisdictionLevel: "state", stateCode: "NM", city: "Santa Fe" },
  { slug: "nmdfa", agencyName: "New Mexico Department of Finance and Administration", agencyType: "state_agency", jurisdictionLevel: "state", stateCode: "NM", city: "Santa Fe" },
  { slug: "cyfd", agencyName: "New Mexico Children, Youth and Families Department", agencyType: "state_agency", jurisdictionLevel: "state", stateCode: "NM", city: "Santa Fe" },
  { slug: "comalisd", agencyName: "Comal Independent School District", agencyType: "k12", jurisdictionLevel: "education", stateCode: "TX" },
  { slug: "bcsdk12", agencyName: "Bibb County School District", agencyType: "k12", jurisdictionLevel: "education", stateCode: "GA", city: "Macon" },
  { slug: "gss", agencyName: "Delaware Government Support Services", agencyType: "state_agency", jurisdictionLevel: "state", stateCode: "DE", city: "Dover" },
  { slug: "dallascityhall", agencyName: "City of Dallas", agencyType: "municipal", jurisdictionLevel: "local", stateCode: "TX", city: "Dallas" },
  { slug: "mtc", agencyName: "Metropolitan Transportation Commission", agencyType: "transportation_authority", jurisdictionLevel: "regional", stateCode: "CA", city: "San Francisco" },
  { slug: "stlcc", agencyName: "St. Louis Community College", agencyType: "higher_ed", jurisdictionLevel: "education", stateCode: "MO", city: "St. Louis" },
  { slug: "midlandtexas", agencyName: "City of Midland", agencyType: "municipal", jurisdictionLevel: "local", stateCode: "TX", city: "Midland" },
  { slug: "cnusdk12", agencyName: "Corona-Norco Unified School District", agencyType: "k12", jurisdictionLevel: "education", stateCode: "CA", city: "Norco" },
  { slug: "hccs", agencyName: "Houston Community College", agencyType: "higher_ed", jurisdictionLevel: "education", stateCode: "TX", city: "Houston" },
  { slug: "universityhealth", agencyName: "University Health", agencyType: "health_authority", jurisdictionLevel: "local", stateCode: "TX", city: "San Antonio" },
];

interface BonfireRawRecord extends Record<string, unknown> {}
function value(record: BonfireRawRecord, ...keys: string[]) { for (const key of keys) { const candidate = record[key]; if (candidate !== undefined && candidate !== null && candidate !== "") return candidate; } return null; }
function text(record: BonfireRawRecord, ...keys: string[]) { const candidate = value(record, ...keys); return candidate === null ? null : String(candidate).trim() || null; }
function numberValue(record: BonfireRawRecord, ...keys: string[]) { const candidate = value(record, ...keys); if (candidate === null) return null; const parsed = typeof candidate === "number" ? candidate : Number(String(candidate).replace(/[$,]/g, "")); return Number.isFinite(parsed) ? parsed : null; }
function looksLikeOpportunity(record: BonfireRawRecord) { return Boolean(text(record, "ProjectID", "ProjectId", "projectId", "Id", "ID", "id") && text(record, "ProjectName", "projectName", "Title", "title", "Name", "name")); }
function recordsFromPayload(payload: unknown): BonfireRawRecord[] {
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): BonfireRawRecord[] => {
    if (depth > 5 || node === null || node === undefined || seen.has(node)) return [];
    if (typeof node === "object") seen.add(node);
    if (Array.isArray(node)) {
      const objects = node.filter((item): item is BonfireRawRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
      if (objects.some(looksLikeOpportunity)) return objects;
      for (const item of node) { const nested = walk(item, depth + 1); if (nested.length) return nested; }
      return [];
    }
    if (typeof node !== "object") return [];
    const record = node as Record<string, unknown>;
    const preferred = ["data", "Data", "projects", "Projects", "opportunities", "Opportunities", "result", "Result", "rows", "Rows", "items", "Items"];
    for (const key of preferred) { if (key in record) { const nested = walk(record[key], depth + 1); if (nested.length) return nested; } }
    for (const nestedValue of Object.values(record)) { const nested = walk(nestedValue, depth + 1); if (nested.length) return nested; }
    return [];
  };
  return walk(payload, 0);
}
function normalizeDate(raw: string | null) { if (!raw) return null; const date = new Date(raw); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function mapRecord(portal: BonfirePortalConfig, raw: BonfireRawRecord): SledOpportunityRecord | null { const projectId = text(raw, "ProjectID", "ProjectId", "projectId", "Id", "ID", "id"); const title = text(raw, "ProjectName", "projectName", "Title", "title", "Name", "name"); if (!projectId || !title) return null; const referenceId = text(raw, "ReferenceID", "ReferenceId", "referenceId", "ReferenceNumber", "referenceNumber", "RefNumber", "refNumber"); const dueAt = normalizeDate(text(raw, "DateClose", "dateClose", "CloseDate", "closeDate", "ClosingDate", "closingDate")); const issueDate = normalizeDate(text(raw, "DateOpen", "dateOpen", "OpenDate", "openDate", "DateCreated", "dateCreated", "CreatedDate", "createdDate")); const statusText = (text(raw, "Status", "status", "ProjectStatus", "projectStatus") || "").toLowerCase(); const deadlineClosed = dueAt ? new Date(dueAt).getTime() < Date.now() : false; const status: "open" | "closed" = deadlineClosed || /closed|awarded|cancelled|canceled|complete/.test(statusText) ? "closed" : "open"; return { externalId: `${portal.slug}:${referenceId || projectId}`, agency: { key: `bonfire:${portal.slug}`, name: portal.agencyName, agencyType: portal.agencyType, jurisdictionLevel: portal.jurisdictionLevel, stateCode: portal.stateCode, city: portal.city || null, website: `https://${portal.slug}.bonfirehub.com` }, title, description: text(raw, "Description", "description", "ProjectDescription", "projectDescription"), solicitationType: text(raw, "OpportunityType", "opportunityType", "ProjectType", "projectType", "SolicitationType", "solicitationType"), procurementMechanism: "Euna Bonfire", status, issueDate, dueAt, estimatedValue: numberValue(raw, "EstimatedBudget", "estimatedBudget", "Budget", "budget", "EstimatedValue", "estimatedValue"), stateCode: portal.stateCode, city: portal.city || null, sourceUrl: `https://${portal.slug}.bonfirehub.com/opportunities/${projectId}`, rawPayload: { platform: "Euna Bonfire", portal: portal.slug, record: raw } }; }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function fetchPortal(portal: BonfirePortalConfig) {
  const endpoint = `https://${portal.slug}.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData?_=${Date.now()}`;
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(endpoint, {
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "accept-language": "en-US,en;q=0.9",
        referer: `https://${portal.slug}.bonfirehub.com/portal/`,
        "user-agent": "Mozilla/5.0 (compatible; PursuitProcurementIndexer/1.0; +https://pursuit.vercel.app)",
        "x-requested-with": "XMLHttpRequest",
      },
      cache: "no-store",
    });
    if (response.status !== 429) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10000) : 1500 * (attempt + 1);
    await sleep(waitMs);
  }
  if (!response || !response.ok) throw new Error(`Bonfire ${portal.slug} returned ${response?.status ?? "no response"}`);
  const payload = await response.json() as unknown;
  const rawRecords = recordsFromPayload(payload);
  if (!rawRecords.length) {
    const serialized = JSON.stringify(payload);
    if (serialized.length > 10 && !/\[\s*\]/.test(serialized)) throw new Error(`Bonfire ${portal.slug} returned an unrecognized public payload shape`);
  }
  return rawRecords.map(raw => mapRecord(portal, raw)).filter((item): item is SledOpportunityRecord => Boolean(item));
}
async function closeMissingBonfireRecords(syncStartedAt: string) { const sql = getSql(); await sql.query(`update opportunities o set status='closed' from sources s where o.source_id=s.id and s.adapter_key='bonfire_public' and o.status='open' and o.last_seen_at < $1::timestamptz`, [syncStartedAt]); }
export async function syncBonfirePublic() {
  const startedAt = new Date().toISOString();
  const failures: Array<{ slug: string; error: string }> = [];
  let portalsSucceeded = 0, opportunitiesSeen = 0, stored = 0, newRecords = 0, changedRecords = 0;
  for (let index = 0; index < VERIFIED_BONFIRE_PORTALS.length; index += 1) {
    const portal = VERIFIED_BONFIRE_PORTALS[index];
    if (index > 0) await sleep(750);
    try {
      const opportunities = (await fetchPortal(portal)).filter(item => item.status === "open");
      opportunitiesSeen += opportunities.length;
      const result = await persistSledOpportunities(SOURCE, opportunities, { mode: "bonfire-family-cron", recordChanges: true, closeMissing: false });
      stored += result.stored; newRecords += result.newRecords; changedRecords += result.changedRecords; portalsSucceeded += 1;
    } catch (error) { failures.push({ slug: portal.slug, error: error instanceof Error ? error.message : String(error) }); }
  }
  if (failures.length) console.warn("Bonfire family refresh partial failure", { failures });
  if (!failures.length && opportunitiesSeen > 0) await closeMissingBonfireRecords(startedAt);
  if (portalsSucceeded === VERIFIED_BONFIRE_PORTALS.length && opportunitiesSeen === 0) {
    console.warn("Bonfire family refresh returned zero opportunities across every configured portal", { portalsConfigured: VERIFIED_BONFIRE_PORTALS.length });
  }
  return { portalsConfigured: VERIFIED_BONFIRE_PORTALS.length, portalsSucceeded, portalsFailed: failures.length, opportunitiesSeen, stored, newRecords, changedRecords, failures, startedAt, completedAt: new Date().toISOString() };
}
