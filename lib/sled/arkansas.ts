import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const PAGE_URL = "https://sas.arkansas.gov/procurement/bid-opportunities/";
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

const SOURCE: SledSourceConfig = {
  adapterKey: "sap_ariba_index_ar",
  sourceName: "Arkansas SAS Bid Opportunities / SAP Ariba",
  baseUrl: PAGE_URL,
  jurisdiction: "Arkansas",
  sourceType: "portal",
};

export interface ArkansasSyncResult {
  stateCode: "AR";
  sourceName: string;
  ok: boolean;
  rowsFetched: number;
  actionableRows: number;
  stored: number;
  newRecords: number;
  changedRecords: number;
  closedRecords: number;
  complete: boolean;
  error?: string;
}

function text(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseCentralDate(value: string, endOfDay = false) {
  const cleaned = text(value);
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const month = String(Number(match[1])).padStart(2, "0");
  const day = String(Number(match[2])).padStart(2, "0");
  const hour = endOfDay ? "23:59:59" : "00:00:00";
  return new Date(`${match[3]}-${month}-${day}T${hour}-05:00`).toISOString();
}

function solicitationType(code: string) {
  const upper = code.toUpperCase();
  if (upper.endsWith("-RFI")) return "Request for Information";
  if (upper.endsWith("-RFQ")) return "Request for Qualifications";
  if (upper.endsWith("-RFP")) return "Request for Proposals";
  if (upper.endsWith("-IFB")) return "Invitation for Bids";
  return "Solicitation";
}

async function fetchRows() {
  const response = await fetch(PAGE_URL, {
    headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8", "user-agent": UA },
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Arkansas SAS bid board returned ${response.status}`);
  const html = await response.text();
  const $ = load(html);
  const table = $("table#table_1");
  if (!table.length) throw new Error("Arkansas SAS bid table not found");
  const rows = table.find("tbody tr").toArray().flatMap(row => {
    const node = $(row);
    const cells = node.children("td").toArray().map(cell => text($(cell).text()));
    const ariba = node.find("a[href*='RfxEvent/preview/']").first().attr("href") || "";
    const stateDetail = node.find("a[href*='/bid-opportunity/']").first().attr("href") || "";
    const code = cells[1] || "";
    const title = cells[2] || "";
    const description = cells[3] || "";
    const postingDate = cells[4] || "";
    const deadline = cells[5] || "";
    const department = cells[6] || "State of Arkansas";
    const commodityCode = cells[31] || cells.find(value => /^\d{2},?\d{3},?\d{3}$/.test(value)) || "";
    if (!code || !title || !ariba) return [];
    return [{ code, title, description, postingDate, deadline, department, ariba, stateDetail, commodityCode }];
  });
  if (!rows.length) throw new Error("Arkansas SAS bid table returned zero Ariba rows");
  return rows;
}

export async function syncArkansasSasAriba(): Promise<ArkansasSyncResult> {
  try {
    const rows = await fetchRows();
    const now = Date.now();
    const records = rows.flatMap(row => {
      const dueAt = parseCentralDate(row.deadline, true);
      if (dueAt && new Date(dueAt).getTime() < now) return [];
      const record: SledOpportunityRecord = {
        externalId: row.code,
        agency: {
          key: `arkansas-sas:${row.department}`,
          name: row.department,
          agencyType: "state_agency",
          jurisdictionLevel: "state",
          stateCode: "AR",
          website: PAGE_URL,
        },
        title: row.title,
        description: row.description || null,
        solicitationType: solicitationType(row.code),
        procurementMechanism: "Arkansas SAS SAP Ariba public solicitation index",
        status: "open",
        issueDate: parseCentralDate(row.postingDate),
        dueAt,
        stateCode: "AR",
        sourceUrl: row.ariba,
        rawPayload: {
          platform: "Arkansas SAS / SAP Ariba",
          code: row.code,
          title: row.title,
          description: row.description || null,
          postingDate: row.postingDate || null,
          responseDeadline: row.deadline || null,
          department: row.department,
          aribaPreview: row.ariba,
          stateDetail: row.stateDetail || null,
          commodityCode: row.commodityCode || null,
          officialIndex: PAGE_URL,
        },
      };
      return [record];
    });
    const persisted = await persistSledOpportunities(SOURCE, records, {
      mode: "arkansas_sas_ariba_refresh",
      recordChanges: true,
      closeMissing: true,
    });
    return {
      stateCode: "AR",
      sourceName: SOURCE.sourceName,
      ok: true,
      rowsFetched: rows.length,
      actionableRows: records.length,
      complete: true,
      ...persisted,
    };
  } catch (error) {
    return {
      stateCode: "AR",
      sourceName: SOURCE.sourceName,
      ok: false,
      rowsFetched: 0,
      actionableRows: 0,
      stored: 0,
      newRecords: 0,
      changedRecords: 0,
      closedRecords: 0,
      complete: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
