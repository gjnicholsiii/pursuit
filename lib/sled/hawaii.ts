import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const API_URL = "https://hands.ehawaii.gov/hands/api/bidding-opportunities";
const BOARD_URL = "https://hands.ehawaii.gov/hands/opportunities";
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";
const PAGE_SIZE = 100;

const SOURCE: SledSourceConfig = {
  adapterKey: "hands_hi",
  sourceName: "Hawaii Awards and Notices Data System (HANDS)",
  baseUrl: BOARD_URL,
  jurisdiction: "Hawaii",
  sourceType: "portal",
};

type HandsRow = {
  category?: string | null;
  closed?: boolean;
  department?: string | null;
  detailsUrl?: string | null;
  division?: string | null;
  dueDate?: string | null;
  island?: string | null;
  jurisdiction?: string | null;
  jurisdictionUrl?: string | null;
  publishDate?: string | null;
  status?: string | null;
  system?: string | null;
  title?: string | null;
  solicitionNo?: string | null;
  id?: number | string | null;
};

type HandsPage = {
  content?: HandsRow[];
  totalElements?: number;
  totalPages?: number;
  number?: number;
  size?: number;
};

type HandsResponse = {
  data?: {
    searchResult?: HandsPage;
    total?: number;
  };
};

export interface HawaiiSyncResult {
  stateCode: "HI";
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

const CRITERIA = {
  query: "",
  showClosed: false,
  showCancelled: false,
  omitPagination: false,
  categories: [],
  procurementCategory: "",
  department: "",
  islands: [],
  statuses: ["POSTED"],
  publishDate: "",
  offerDueDate: "",
  jurisdiction: "",
};

async function fetchPage(page: number): Promise<HandsResponse> {
  const response = await fetch(`${API_URL}?size=${PAGE_SIZE}&page=${page}&sort=publish_date_dt,desc`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": UA,
    },
    body: JSON.stringify(CRITERIA),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Hawaii HANDS page ${page + 1} returned ${response.status}`);
  return response.json() as Promise<HandsResponse>;
}

async function fetchPostedRows() {
  const first = await fetchPage(0);
  const firstResult = first.data?.searchResult;
  const sourceCount = Number(first.data?.total);
  const totalElements = Number(firstResult?.totalElements);
  const pages = Number(firstResult?.totalPages);
  if (!Number.isFinite(sourceCount) || sourceCount < 0 || sourceCount !== totalElements) {
    throw new Error(`Hawaii HANDS initial reconciliation failed: total=${sourceCount}, totalElements=${totalElements}`);
  }
  if (!Number.isInteger(pages) || pages < 0) throw new Error(`Hawaii HANDS returned invalid page count: ${pages}`);
  const rows: HandsRow[] = [...(firstResult?.content || [])];
  for (let page = 1; page < pages; page += 1) {
    const response = await fetchPage(page);
    const result = response.data?.searchResult;
    if (Number(response.data?.total) !== sourceCount || Number(result?.totalElements) !== sourceCount || Number(result?.number) !== page) {
      throw new Error(`Hawaii HANDS page ${page + 1} reconciliation failed`);
    }
    rows.push(...(result?.content || []));
  }
  const keys = rows.map(row => row.id == null ? "" : `${row.system || "HANDS"}:${row.id}`).filter(Boolean);
  const unique = new Set(keys);
  if (rows.length !== sourceCount || keys.length !== sourceCount || unique.size !== sourceCount) {
    throw new Error(`Hawaii HANDS reconciliation failed: count=${sourceCount}, rows=${rows.length}, ids=${keys.length}, unique=${unique.size}`);
  }
  return { sourceCount, pages, rows };
}

function parseHawaiiDate(value: string | null | undefined, endOfDay = false) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s+(AM|PM))?$/i);
  if (!match) return null;
  const month = String(Number(match[1])).padStart(2, "0");
  const day = String(Number(match[2])).padStart(2, "0");
  let hour = match[4] ? Number(match[4]) : (endOfDay ? 23 : 0);
  const minute = match[5] || (endOfDay ? "59" : "00");
  const ampm = match[6]?.toUpperCase();
  if (ampm) {
    if (hour === 12) hour = 0;
    if (ampm === "PM") hour += 12;
  }
  return new Date(`${match[3]}-${month}-${day}T${String(hour).padStart(2, "0")}:${minute}:00-10:00`).toISOString();
}

function classifyAgency(row: HandsRow) {
  const text = `${row.jurisdiction || ""} ${row.department || ""}`.toLowerCase();
  if (/university|education|school/.test(text)) return { agencyType: "education" as const, jurisdictionLevel: "state" as const };
  if (/county|city|water supply|rapid transit|municip/.test(text)) return { agencyType: "local_agency" as const, jurisdictionLevel: "local" as const };
  return { agencyType: "state_agency" as const, jurisdictionLevel: "state" as const };
}

function solicitationType(row: HandsRow) {
  const no = String(row.solicitionNo || "").toUpperCase();
  if (/\bRFI\b/.test(no)) return "Request for Information";
  if (/\bRFP\b/.test(no)) return "Request for Proposals";
  if (/\bRFQ\b|\bSOQ\b/.test(no)) return "Request for Qualifications";
  if (/\bIFB\b|^B\d/.test(no)) return "Invitation for Bids";
  return row.category || "Solicitation";
}

export async function syncHawaiiHands(): Promise<HawaiiSyncResult> {
  try {
    const { sourceCount, pages, rows } = await fetchPostedRows();
    const now = Date.now();
    let staleRows = 0;
    const records = rows.flatMap(row => {
      if (row.id == null || !row.title || row.closed) return [];
      const dueAt = parseHawaiiDate(row.dueDate, true);
      if (dueAt && new Date(dueAt).getTime() < now) {
        staleRows += 1;
        return [];
      }
      const system = row.system || "HANDS";
      const agencyName = [row.jurisdiction, row.department].filter(Boolean).join(" / ") || "State of Hawaii";
      const agencyClass = classifyAgency(row);
      const sourceUrl = row.detailsUrl || `${BOARD_URL}/opportunity-details/${row.id}`;
      const record: SledOpportunityRecord = {
        externalId: `${system}:${row.id}`,
        agency: {
          key: `hawaii-hands:${row.jurisdiction || "state"}:${row.department || "unknown"}`,
          name: agencyName,
          agencyType: agencyClass.agencyType,
          jurisdictionLevel: agencyClass.jurisdictionLevel,
          stateCode: "HI",
          website: row.jurisdictionUrl || BOARD_URL,
        },
        title: row.title,
        description: null,
        solicitationType: solicitationType(row),
        procurementMechanism: `Hawaii HANDS aggregated public solicitation (${system})`,
        status: "open",
        issueDate: parseHawaiiDate(row.publishDate),
        dueAt,
        stateCode: "HI",
        sourceUrl,
        rawPayload: {
          platform: "Hawaii Awards and Notices Data System (HANDS)",
          system,
          id: row.id,
          solicitationNo: row.solicitionNo || null,
          category: row.category || null,
          jurisdiction: row.jurisdiction || null,
          department: row.department || null,
          division: row.division || null,
          island: row.island || null,
          publishDate: row.publishDate || null,
          dueDate: row.dueDate || null,
          status: row.status || null,
          detailsUrl: row.detailsUrl || null,
          jurisdictionUrl: row.jurisdictionUrl || null,
          officialBoard: BOARD_URL,
        },
      };
      return [record];
    });

    const persisted = await persistSledOpportunities(SOURCE, records, {
      mode: "hawaii_hands_posted_refresh",
      recordChanges: true,
      closeMissing: true,
    });
    return {
      stateCode: "HI",
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
      stateCode: "HI",
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
