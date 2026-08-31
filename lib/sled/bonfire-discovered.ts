import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const SOURCE: SledSourceConfig = {
  adapterKey: "bonfire_public",
  sourceName: "Euna Bonfire Public Procurement Network",
  baseUrl: "https://bonfirehub.com",
  jurisdiction: "United States",
  sourceType: "portal",
};

export type DiscoveredBonfirePortal = {
  slug: string;
  agencyName: string;
  stateCode: string;
  city?: string | null;
  agencyType?: string;
  jurisdictionLevel?: string;
};

type Raw = Record<string, unknown>;

function text(row: Raw, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function recordsFromPayload(payload: unknown): Raw[] {
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth = 0): Raw[] => {
    if (depth > 7 || node === null || node === undefined || seen.has(node)) return [];
    if (typeof node === "object") seen.add(node);
    if (Array.isArray(node)) {
      const rows = node.filter((item): item is Raw => Boolean(item) && typeof item === "object" && !Array.isArray(item));
      const matches = rows.filter(row => text(row,"ProjectID","ProjectId","projectId","Id","ID","id") && text(row,"ProjectName","projectName","Title","title","Name","name"));
      if (matches.length) return matches;
      for (const item of node) { const found = walk(item, depth + 1); if (found.length) return found; }
      return [];
    }
    if (typeof node !== "object") return [];
    const row = node as Raw;
    if (text(row,"ProjectID","ProjectId","projectId","Id","ID","id") && text(row,"ProjectName","projectName","Title","title","Name","name")) return [row];
    for (const value of Object.values(row)) { const found = walk(value, depth + 1); if (found.length) return found; }
    return [];
  };
  return walk(payload);
}

function iso(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function map(portal: DiscoveredBonfirePortal, row: Raw): SledOpportunityRecord | null {
  const projectId = text(row,"ProjectID","ProjectId","projectId","Id","ID","id");
  const title = text(row,"ProjectName","projectName","Title","title","Name","name");
  if (!projectId || !title) return null;
  const referenceId = text(row,"ReferenceID","ReferenceId","referenceId","ReferenceNumber","referenceNumber","RefNumber","refNumber");
  const dueAt = iso(text(row,"DateClose","dateClose","CloseDate","closeDate","ClosingDate","closingDate"));
  const issueDate = iso(text(row,"DateOpen","dateOpen","OpenDate","openDate","DateCreated","dateCreated","CreatedDate","createdDate"));
  const statusText = (text(row,"Status","status","ProjectStatus","projectStatus") || "").toLowerCase();
  const closed = /closed|awarded|cancelled|canceled|complete/.test(statusText) || Boolean(dueAt && new Date(dueAt).getTime() < Date.now());
  return {
    externalId: `${portal.slug}:${referenceId || projectId}`,
    agency: {
      key: `bonfire:${portal.slug}`,
      name: portal.agencyName,
      agencyType: portal.agencyType || "k12",
      jurisdictionLevel: portal.jurisdictionLevel || "education",
      stateCode: portal.stateCode,
      city: portal.city || null,
      website: `https://${portal.slug}.bonfirehub.com`,
    },
    title,
    description: text(row,"Description","description","ProjectDescription","projectDescription"),
    solicitationType: text(row,"OpportunityType","opportunityType","ProjectType","projectType","SolicitationType","solicitationType"),
    procurementMechanism: "Euna Bonfire",
    status: closed ? "closed" : "open",
    issueDate,
    dueAt,
    stateCode: portal.stateCode,
    city: portal.city || null,
    sourceUrl: `https://${portal.slug}.bonfirehub.com/opportunities/${projectId}`,
    rawPayload: { platform: "Euna Bonfire", discoveryMode: "national-platform-family", portal: portal.slug, record: row },
  };
}

async function fetchPortal(portal: DiscoveredBonfirePortal) {
  const endpoint = `https://${portal.slug}.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData?_=${Date.now()}`;
  const response = await fetch(endpoint, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      referer: `https://${portal.slug}.bonfirehub.com/portal/`,
      "user-agent": "Mozilla/5.0 (compatible; PursuitProcurementIndexer/1.0)",
      "x-requested-with": "XMLHttpRequest",
    },
  });
  if (!response.ok) throw new Error(`Bonfire ${portal.slug} returned ${response.status}`);
  const payload = await response.json() as unknown;
  return recordsFromPayload(payload)
    .map(row => map(portal,row))
    .filter((item): item is SledOpportunityRecord => item !== null)
    .filter(item => item.status === "open");
}

export async function syncDiscoveredBonfirePortals(portals: DiscoveredBonfirePortal[]) {
  const unique = [...new Map(portals.map(portal => [portal.slug.toLowerCase(), {...portal, slug: portal.slug.toLowerCase()}])).values()];
  const diagnostics: Array<{slug:string;ok:boolean;discovered?:number;stored?:number;error?:string}> = [];
  let stored = 0;
  for (let i = 0; i < unique.length; i += 4) {
    const batch = await Promise.all(unique.slice(i,i+4).map(async portal => {
      try {
        const opportunities = await fetchPortal(portal);
        const persisted = await persistSledOpportunities(SOURCE, opportunities, { mode:"bonfire-discovered-family", recordChanges:false, closeMissing:false });
        return { slug:portal.slug, ok:true, discovered:opportunities.length, stored:persisted.stored };
      } catch (error) {
        return { slug:portal.slug, ok:false, error:error instanceof Error ? error.message : String(error) };
      }
    }));
    diagnostics.push(...batch);
    stored += batch.reduce((sum,row)=>sum + (row.ok ? Number(row.stored || 0) : 0),0);
  }
  return { portals:unique.length, succeeded:diagnostics.filter(row=>row.ok).length, failed:diagnostics.filter(row=>!row.ok).length, stored, diagnostics };
}
