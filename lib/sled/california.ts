import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const CA_PSP = "https://caleprocure.ca.gov/psp/psfpd1_3/SUPPLIER/ERP/c/AUC_MANAGE_BIDS.AUC_RESP_INQ_AUC.GBL";
const CA_PSC = "https://caleprocure.ca.gov/psc/psfpd1_3/SUPPLIER/ERP/c/AUC_MANAGE_BIDS.AUC_RESP_INQ_AUC.GBL";

const SOURCE: SledSourceConfig = {
  adapterKey: "peoplesoft_ca",
  sourceName: "California Cal eProcure Public Events",
  baseUrl: CA_PSP,
  jurisdiction: "California",
  sourceType: "portal",
};

export interface CaliforniaSyncResult {
  stateCode: "CA";
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  rowsParsed: number;
  totalReported: number | null;
  stored: number;
  newRecords: number;
  changedRecords: number;
  closedRecords?: number;
  pageLimited: false;
  error?: string;
}

function text(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function collectCookies(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(value => value.split(";", 1)[0]);
}

function parsePacificDate(value: string) {
  const cleaned = text(value);
  if (!cleaned) return null;
  const normalized = cleaned
    .replace(/\bPDT\b/g, "GMT-0700")
    .replace(/\bPST\b/g, "GMT-0800");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function classifyAgency(name: string) {
  const n = name.toLowerCase();
  if (/university|college|cal state|state university/.test(n)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/school|education/.test(n)) return { agencyType: "k12", jurisdictionLevel: "state" };
  if (/authority|commission|district/.test(n)) return { agencyType: "authority", jurisdictionLevel: "state" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

async function fetchCaliforniaHtml() {
  const first = await fetch(CA_PSP, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    redirect: "manual",
    cache: "no-store",
  });

  const cookies = collectCookies(first);
  const location = first.headers.get("location");
  const secondUrl = location ? new URL(location, CA_PSP).toString() : CA_PSP;
  const baseHeaders = {
    accept: "text/html,application/xhtml+xml",
    "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    ...(cookies.length ? { cookie: cookies.join("; ") } : {}),
  };

  const second = await fetch(secondUrl, {
    headers: baseHeaders,
    redirect: "follow",
    cache: "no-store",
  });
  const allCookies = [...new Map([...cookies, ...collectCookies(second)].map(value => [value.split("=")[0], value])).values()];

  const component = await fetch(CA_PSC, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
      ...(allCookies.length ? { cookie: allCookies.join("; ") } : {}),
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!component.ok) throw new Error(`California Cal eProcure returned ${component.status}`);
  return component.text();
}

function parseCalifornia(html: string) {
  const $ = load(html);
  const body = text($("body").text());
  const totalReported = Number(body.match(/\b1\s*-\s*\d+\s+of\s+(\d+)\b/i)?.[1] || 0) || null;
  const parsedRows: Array<{
    departmentCode: string;
    agencyName: string;
    eventId: string;
    title: string;
    format: string;
    type: string;
    endText: string;
    status: string;
    buyerName: string;
    buyerEmail: string;
  }> = [];

  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 10) return;
    const cell = (index: number) => text($(cells[index]).text());
    const departmentCode = cell(0);
    const agencyName = cell(1);
    const eventId = cell(2);
    const title = cell(3);
    const format = cell(4);
    const type = cell(5);
    const endText = cell(6);
    const status = cell(7);
    const buyerName = cell(8);
    const buyerEmail = cell(9);
    if (!departmentCode || !agencyName || !eventId || !title) return;
    if (!/^[A-Z0-9-]+$/i.test(eventId.replace(/\s+/g, ""))) return;
    if (!/posted/i.test(status)) return;
    parsedRows.push({ departmentCode, agencyName, eventId, title, format, type, endText, status, buyerName, buyerEmail });
  });

  const records: SledOpportunityRecord[] = parsedRows.flatMap(row => {
    const dueAt = parsePacificDate(row.endText);
    if (!dueAt || new Date(dueAt).getTime() < Date.now()) return [];
    const agencyClass = classifyAgency(row.agencyName);
    const upper = row.title.toUpperCase();
    const solicitationType = /\bRFI\b/.test(upper) ? "RFI"
      : /\bRFQ\b/.test(upper) ? "RFQ"
      : /\bRFP\b/.test(upper) ? "RFP"
      : /\bIFB\b|INVITATION FOR BID/.test(upper) ? "IFB"
      : row.type || "Sell RFx";

    return [{
      externalId: `${row.departmentCode}:${row.eventId}`,
      agency: {
        key: `california:${row.departmentCode}:${row.agencyName}`,
        name: row.agencyName,
        agencyType: agencyClass.agencyType,
        jurisdictionLevel: agencyClass.jurisdictionLevel,
        stateCode: "CA",
        website: CA_PSP,
      },
      title: row.title,
      solicitationType,
      procurementMechanism: "California Cal eProcure public sourcing event",
      status: "open",
      dueAt,
      stateCode: "CA",
      sourceUrl: CA_PSP,
      rawPayload: {
        platform: "Cal eProcure / PeopleSoft Supplier Portal",
        departmentCode: row.departmentCode,
        departmentName: row.agencyName,
        eventId: row.eventId,
        eventName: row.title,
        format: row.format || null,
        eventType: row.type || null,
        endDate: row.endText,
        status: row.status,
        buyerName: row.buyerName || null,
        buyerEmail: row.buyerEmail || null,
        sourcePage: CA_PSP,
      },
    }];
  });

  return {
    totalReported,
    rowsParsed: parsedRows.length,
    records: [...new Map(records.map(record => [record.externalId, record])).values()],
  };
}

export async function syncCaliforniaPeopleSoft(): Promise<CaliforniaSyncResult> {
  try {
    const html = await fetchCaliforniaHtml();
    const { totalReported, rowsParsed, records } = parseCalifornia(html);
    if (!rowsParsed) throw new Error("No California public event rows were parsed");
    if (totalReported !== null && rowsParsed !== totalReported) {
      throw new Error(`California completeness check failed: parsed ${rowsParsed} of ${totalReported} reported events`);
    }
    const persisted = await persistSledOpportunities(SOURCE, records, {
      mode: "california_peoplesoft_refresh",
      recordChanges: true,
      closeMissing: true,
    });
    return {
      stateCode: "CA",
      sourceName: SOURCE.sourceName,
      ok: true,
      rowsFound: records.length,
      rowsParsed,
      totalReported,
      ...persisted,
      pageLimited: false,
    };
  } catch (error) {
    return {
      stateCode: "CA",
      sourceName: SOURCE.sourceName,
      ok: false,
      rowsFound: 0,
      rowsParsed: 0,
      totalReported: null,
      stored: 0,
      newRecords: 0,
      changedRecords: 0,
      pageLimited: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
