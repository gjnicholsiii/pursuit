import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const API_BASE = "https://vendor.myfloridamarketplace.com/mfmp";
const BOARD_URL = "https://vendor.myfloridamarketplace.com/search/bids";
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";
const PAGE_SIZE = 100;

const ACTIONABLE_TYPES = [
  { id: "4", value: "Invitation to Bid" },
  { id: "5", value: "Invitation to Negotiate" },
  { id: "6", value: "Request for Proposals" },
  { id: "8", value: "Request for Information" },
  { id: "9", value: "Request for Statement of Qualifications" },
];

const SOURCE: SledSourceConfig = {
  adapterKey: "mfmp_vip_fl",
  sourceName: "Florida MFMP Vendor Information Portal (VIP)",
  baseUrl: BOARD_URL,
  jurisdiction: "Florida",
  sourceType: "portal",
};

type VipOrganization = {
  organizationId?: number;
  entity?: string | null;
  shortName?: string | null;
  vbsAgency?: boolean;
  version?: number;
  name?: string | null;
};

type VipBid = {
  agencyAdNumber?: string | null;
  type?: string | null;
  title?: string | null;
  openDate?: string | null;
  closeDate?: string | null;
  status?: string | null;
  typeId?: string | null;
  version?: number;
  advertisementId?: number;
  uniqueName?: string | null;
  publishDate?: string | null;
  organization?: VipOrganization | null;
  agency?: string | null;
};

export interface FloridaSyncResult {
  stateCode: "FL";
  sourceName: string;
  ok: boolean;
  sourceCount: number;
  rowsFetched: number;
  actionableRows: number;
  staleRows: number;
  pages: number;
  stored: number;
  newRecords: number;
  changedRecords: number;
  closedRecords: number;
  complete: boolean;
  error?: string;
}

function criteria(page?: number) {
  return {
    pageSize: PAGE_SIZE,
    type: ACTIONABLE_TYPES,
    status: ["OPEN"],
    agency: [],
    adNumber: "",
    agencyAdvertisementNumber: "",
    title: "",
    publishedDate: "",
    openDate: "",
    endDate: "",
    commodityCodes: [],
    intendsToParticipate: "",
    assignee: "",
    ...(page ? { page } : {}),
  };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json,text/plain,*/*",
      "content-type": "application/json",
      "user-agent": UA,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Florida VIP ${path} returned ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchOpenRows() {
  const sourceCountRaw = await postJson<number | string>("/pub/search/bids/count", criteria());
  const sourceCount = Number(sourceCountRaw);
  if (!Number.isFinite(sourceCount) || sourceCount < 0) throw new Error(`Florida VIP returned invalid count: ${String(sourceCountRaw)}`);
  const pages = Math.max(1, Math.ceil(sourceCount / PAGE_SIZE));
  const rows: VipBid[] = [];
  for (let page = 1; page <= pages; page += 1) {
    const pageRows = await postJson<VipBid[]>("/pub/search/bids", criteria(page));
    if (!Array.isArray(pageRows)) throw new Error(`Florida VIP page ${page} did not return an array`);
    rows.push(...pageRows);
  }
  const ids = rows.map(row => row.advertisementId).filter((id): id is number => Number.isFinite(id));
  const unique = new Set(ids);
  const complete = rows.length === sourceCount && ids.length === sourceCount && unique.size === sourceCount;
  if (!complete) throw new Error(`Florida VIP reconciliation failed: count=${sourceCount}, rows=${rows.length}, ids=${ids.length}, unique=${unique.size}`);
  return { sourceCount, pages, rows };
}

function agencyType(row: VipBid) {
  const name = String(row.agency || row.organization?.name || "").toLowerCase();
  if (/university|college|school/.test(name)) return "education" as const;
  if (/county|city|town|municip|district/.test(name)) return "local_agency" as const;
  return "state_agency" as const;
}

export async function syncFloridaVip(): Promise<FloridaSyncResult> {
  try {
    const { sourceCount, pages, rows } = await fetchOpenRows();
    const now = Date.now();
    let staleRows = 0;
    const records = rows.flatMap(row => {
      if (!row.advertisementId || !row.title || String(row.status || "").toUpperCase() !== "OPEN") return [];
      const dueAt = row.closeDate ? new Date(row.closeDate).toISOString() : null;
      if (dueAt && new Date(dueAt).getTime() < now) {
        staleRows += 1;
        return [];
      }
      const agencyName = row.agency || row.organization?.name || "State of Florida";
      const detailUrl = `${BOARD_URL}/detail/${row.advertisementId}`;
      const record: SledOpportunityRecord = {
        externalId: String(row.advertisementId),
        agency: {
          key: `florida-vip:${row.organization?.organizationId || agencyName}`,
          name: agencyName,
          agencyType: agencyType(row),
          jurisdictionLevel: agencyType(row) === "state_agency" ? "state" : "local",
          stateCode: "FL",
          website: BOARD_URL,
        },
        title: row.title,
        description: null,
        solicitationType: row.type || "Solicitation",
        procurementMechanism: "Florida MFMP Vendor Information Portal public competitive advertisement",
        status: "open",
        issueDate: row.publishDate ? new Date(row.publishDate).toISOString() : null,
        dueAt,
        stateCode: "FL",
        sourceUrl: detailUrl,
        rawPayload: {
          platform: "MyFloridaMarketPlace Vendor Information Portal",
          advertisementId: row.advertisementId,
          uniqueName: row.uniqueName || null,
          agencyAdNumber: row.agencyAdNumber || null,
          type: row.type || null,
          typeId: row.typeId || null,
          version: row.version ?? null,
          publishDate: row.publishDate || null,
          openDate: row.openDate || null,
          closeDate: row.closeDate || null,
          status: row.status || null,
          agency: agencyName,
          organization: row.organization || null,
          officialBoard: BOARD_URL,
        },
      };
      return [record];
    });

    const persisted = await persistSledOpportunities(SOURCE, records, {
      mode: "florida_vip_open_refresh",
      recordChanges: true,
      closeMissing: true,
    });
    return {
      stateCode: "FL",
      sourceName: SOURCE.sourceName,
      ok: true,
      sourceCount,
      rowsFetched: rows.length,
      actionableRows: records.length,
      staleRows,
      pages,
      complete: true,
      ...persisted,
    };
  } catch (error) {
    return {
      stateCode: "FL",
      sourceName: SOURCE.sourceName,
      ok: false,
      sourceCount: 0,
      rowsFetched: 0,
      actionableRows: 0,
      staleRows: 0,
      pages: 0,
      stored: 0,
      newRecords: 0,
      changedRecords: 0,
      closedRecords: 0,
      complete: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
