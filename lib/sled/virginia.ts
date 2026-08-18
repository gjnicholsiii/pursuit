import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const ROOT = "https://mvendor.cgieva.com/Vendor/public/";
const BOARD = `${ROOT}AllOpportunities.jsp`;
const SOLR = `${ROOT}solrconnect.jsp`;
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

const SOURCE: SledSourceConfig = {
  adapterKey: "eva_vbo_va",
  sourceName: "Virginia eVA Vendor Bulletin Board",
  baseUrl: BOARD,
  jurisdiction: "Virginia",
  sourceType: "portal",
};

type EvaDoc = Record<string, unknown>;

export interface VirginiaSyncResult {
  stateCode: "VA";
  sourceName: string;
  ok: boolean;
  totalReported: number | null;
  rowsFetched: number;
  actionableRows: number;
  staleOpenRows: number;
  stored: number;
  newRecords: number;
  changedRecords: number;
  closedRecords?: number;
  pageLimited: false;
  error?: string;
}

function value(input: unknown) {
  return String(input ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function collectCookies(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(v => v.split(";", 1)[0]).join("; ");
}

function iso(input: unknown) {
  const raw = value(input);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function classifyAgency(name: string) {
  const n = name.toLowerCase();
  if (/university|college|community college/.test(n)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/school|public schools|school board/.test(n)) return { agencyType: "k12", jurisdictionLevel: "local" };
  if (/^city of |^town of |^county of | county$/.test(n)) return { agencyType: "local_government", jurisdictionLevel: "local" };
  if (/authority|commission|district/.test(n)) return { agencyType: "authority", jurisdictionLevel: "local" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

async function fetchOpenDocs() {
  const landing = await fetch(BOARD, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA },
    redirect: "follow",
    cache: "no-store",
  });
  if (!landing.ok) throw new Error(`Virginia eVA landing page returned ${landing.status}`);
  const cookie = collectCookies(landing);

  const url = new URL(SOLR);
  url.searchParams.set("q", "status:Open");
  url.searchParams.set("rows", "1000");
  url.searchParams.set("start", "0");
  url.searchParams.set("facet", "off");
  url.searchParams.set("wt", "json");

  const response = await fetch(url, {
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent": UA,
      referer: landing.url,
      ...(cookie ? { cookie } : {}),
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Virginia eVA Solr bridge returned ${response.status}`);
  const raw = await response.text();
  let json: any;
  try { json = JSON.parse(raw); } catch { throw new Error("Virginia eVA Solr bridge returned invalid JSON"); }
  const totalReported = Number(json?.response?.numFound);
  const docs: EvaDoc[] = Array.isArray(json?.response?.docs) ? json.response.docs : [];
  if (!Number.isFinite(totalReported)) throw new Error("Virginia eVA did not report a result total");
  if (totalReported > 1000) throw new Error(`Virginia eVA completeness check failed: ${totalReported} open records exceed fetch ceiling`);
  if (docs.length !== totalReported) throw new Error(`Virginia eVA completeness check failed: fetched ${docs.length} of ${totalReported} open records`);
  return { totalReported, docs };
}

function toRecord(doc: EvaDoc): SledOpportunityRecord | null {
  const externalId = value(doc.id) || `${value(doc.app)}:${value(doc.internalid)}`;
  const agencyName = value(doc.agencyname);
  const agencyCode = value(doc.agency) || value(doc.docdeptcd) || agencyName;
  const title = value(doc.shortdesc) || value(doc.longdesc);
  if (!externalId || !agencyName || !title) return null;

  const dueAt = iso(doc.closedate);
  if (dueAt && new Date(dueAt).getTime() < Date.now()) return null;
  const issueDate = iso(doc.pubdate);
  const agencyClass = classifyAgency(agencyName);
  const commCodes = Array.isArray(doc.commcode) ? doc.commcode.map(value).filter(Boolean) : [];
  const commDescriptions = Array.isArray(doc.commdesc) ? doc.commdesc.map(value).filter(Boolean) : [];
  const location = value(doc.workloc);

  return {
    externalId,
    agency: {
      key: `virginia:${agencyCode}:${agencyName}`,
      name: agencyName,
      agencyType: agencyClass.agencyType,
      jurisdictionLevel: agencyClass.jurisdictionLevel,
      stateCode: "VA",
      website: BOARD,
    },
    title,
    description: value(doc.longdesc) || null,
    solicitationType: value(doc.doccd) || value(doc.doccddesc) || null,
    procurementMechanism: value(doc.doccddesc) || "Virginia eVA public solicitation",
    status: "open",
    issueDate,
    dueAt,
    stateCode: "VA",
    sourceUrl: BOARD,
    rawPayload: {
      platform: "Virginia eVA Vendor Bulletin Board",
      app: value(doc.app) || null,
      internalId: value(doc.internalid) || null,
      externalSolicitationId: value(doc.externalid) || null,
      agencyCode,
      buyerName: value(doc.buyername) || null,
      category: value(doc.category) || null,
      categoryShort: value(doc.categoryshortdesc) || null,
      commodityCodes: commCodes,
      commodityDescriptions: commDescriptions,
      workLocation: location || null,
      sourceStatus: value(doc.status) || null,
      lastUpdatedAt: iso(doc.lastupdatedate),
      sourcePage: BOARD,
    },
  };
}

export async function syncVirginiaEva(): Promise<VirginiaSyncResult> {
  try {
    const { totalReported, docs } = await fetchOpenDocs();
    const records = docs.map(toRecord).filter((record): record is SledOpportunityRecord => Boolean(record));
    const unique = [...new Map(records.map(record => [record.externalId, record])).values()];
    const staleOpenRows = docs.length - unique.length;
    const persisted = await persistSledOpportunities(SOURCE, unique, {
      mode: "virginia_eva_refresh",
      recordChanges: true,
      closeMissing: true,
    });
    return {
      stateCode: "VA",
      sourceName: SOURCE.sourceName,
      ok: true,
      totalReported,
      rowsFetched: docs.length,
      actionableRows: unique.length,
      staleOpenRows,
      ...persisted,
      pageLimited: false,
    };
  } catch (error) {
    return {
      stateCode: "VA",
      sourceName: SOURCE.sourceName,
      ok: false,
      totalReported: null,
      rowsFetched: 0,
      actionableRows: 0,
      staleOpenRows: 0,
      stored: 0,
      newRecords: 0,
      changedRecords: 0,
      pageLimited: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
