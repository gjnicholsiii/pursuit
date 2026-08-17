import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const DELAWARE_DATASET_ID = "2hnj-zwix";
const DELAWARE_API_URL = `https://data.delaware.gov/resource/${DELAWARE_DATASET_ID}.json?$limit=5000`;
const DELAWARE_BIDS_URL = "https://mmp.delaware.gov/Bids";

const DELAWARE_SOURCE: SledSourceConfig = {
  adapterKey: "delaware_open_bids_de",
  sourceName: "Delaware Open Bids",
  baseUrl: DELAWARE_BIDS_URL,
  jurisdiction: "Delaware",
  sourceType: "api",
};

interface DelawareOpenBidRaw {
  contractnumber?: string;
  contracttitle?: string;
  opendate?: string;
  deadlinedate?: string;
  agencycode?: string;
  unspsc?: string;
  bidurl?: string | { url?: string; description?: string };
  count?: string | number;
}

export interface DelawareSyncResult {
  stateCode: "DE";
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  stored: number;
  newRecords: number;
  changedRecords: number;
  pageLimited: false;
  error?: string;
}

function text(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function sourceUrl(value: DelawareOpenBidRaw["bidurl"]) {
  if (typeof value === "string") return value || DELAWARE_BIDS_URL;
  return value?.url || DELAWARE_BIDS_URL;
}

function offsetMinutes(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, Number(part.value)]),
  );
  const wallClockAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (wallClockAsUtc - date.getTime()) / 60000;
}

function parseDelawareFloatingDate(value?: string) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const [, year, month, day, hour, minute, second = "0"] = match;
  const wallClockUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  let guess = new Date(wallClockUtc);
  for (let i = 0; i < 2; i += 1) {
    const offset = offsetMinutes(guess, "America/New_York");
    guess = new Date(wallClockUtc - offset * 60000);
  }
  return guess.toISOString();
}

function classifyTitle(title: string) {
  if (/\bRFP\b|request for proposals?/i.test(title)) return "RFP";
  if (/\bRFQ\b|request for quotations?|request for qualifications?/i.test(title)) return "RFQ";
  if (/\bRFI\b|request for information/i.test(title)) return "RFI";
  if (/\bITB\b|invitation to bid/i.test(title)) return "ITB";
  return "State solicitation";
}

function normalizeDelawareBid(raw: DelawareOpenBidRaw): SledOpportunityRecord | null {
  const externalId = text(raw.contractnumber);
  const title = text(raw.contracttitle);
  const agencyCode = text(raw.agencycode);
  if (!externalId || !title) return null;

  const dueAt = parseDelawareFloatingDate(raw.deadlinedate);
  if (dueAt && new Date(dueAt).getTime() < Date.now()) return null;

  const issueDate = parseDelawareFloatingDate(raw.opendate);
  const url = sourceUrl(raw.bidurl);

  return {
    externalId,
    agency: {
      key: `delaware:${agencyCode || "state"}`,
      name: agencyCode ? `State of Delaware - ${agencyCode}` : "State of Delaware",
      agencyType: "state_agency",
      jurisdictionLevel: "state",
      stateCode: "DE",
      website: DELAWARE_BIDS_URL,
    },
    title,
    solicitationType: classifyTitle(title),
    procurementMechanism: "Delaware public solicitation",
    status: "open",
    issueDate,
    dueAt,
    stateCode: "DE",
    sourceUrl: url,
    rawPayload: {
      platform: "Delaware Open Data / MyMarketplace",
      datasetId: DELAWARE_DATASET_ID,
      contractNumber: externalId,
      contractTitle: title,
      openDate: raw.opendate || null,
      deadlineDate: raw.deadlinedate || null,
      agencyCode: agencyCode || null,
      unspsc: text(raw.unspsc) || null,
      bidUrl: url,
      sourceDataset: DELAWARE_API_URL,
      sourceDirectory: DELAWARE_BIDS_URL,
      refreshCadence: "weekly official open-data mirror; bidUrl is authoritative live detail",
    },
  };
}

async function fetchDelawareOpenBids() {
  const response = await fetch(DELAWARE_API_URL, {
    headers: {
      accept: "application/json",
      "user-agent": "PursuitGovernmentRevenue/1.0",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Delaware Open Data returned ${response.status}`);
  const raw = await response.json() as DelawareOpenBidRaw[];
  return [...new Map(
    raw.map(normalizeDelawareBid)
      .filter((record): record is SledOpportunityRecord => Boolean(record))
      .map(record => [record.externalId, record]),
  ).values()];
}

export async function syncDelawareOpenBids(bootstrap = false): Promise<DelawareSyncResult> {
  try {
    const records = await fetchDelawareOpenBids();
    if (!records.length) throw new Error("No current Delaware open bids were parsed");
    const persisted = await persistSledOpportunities(DELAWARE_SOURCE, records, {
      mode: bootstrap ? "delaware_open_data_bootstrap" : "delaware_open_data_refresh",
      recordChanges: !bootstrap,
    });
    return {
      stateCode: "DE",
      sourceName: DELAWARE_SOURCE.sourceName,
      ok: true,
      rowsFound: records.length,
      ...persisted,
      pageLimited: false,
    };
  } catch (error) {
    return {
      stateCode: "DE",
      sourceName: DELAWARE_SOURCE.sourceName,
      ok: false,
      rowsFound: 0,
      stored: 0,
      newRecords: 0,
      changedRecords: 0,
      pageLimited: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
