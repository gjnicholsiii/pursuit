import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const BOARD_ID = "3444a404-3818-494f-84c5-2a850acd7779";
const BOARD_URL = `https://postingboard.esmsolutions.com/${BOARD_ID}/events`;
const API_URL = `https://postingboard.esmsolutions.com/api/postingBoard/${BOARD_ID}/currentevents`;
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

const SOURCE: SledSourceConfig = {
  adapterKey: "esm_posting_board_sd",
  sourceName: "South Dakota Central Bid Exchange / ESM Posting Board",
  baseUrl: BOARD_URL,
  jurisdiction: "South Dakota",
  sourceType: "api",
};

type EsmEvent = {
  eventId?: string | number | null;
  id?: string | null;
  eventName?: string | null;
  publishedDate?: string | null;
  eventDueDate?: string | null;
  invitationType?: { id?: number | null; description?: string | null } | null;
  status?: { id?: number | null; description?: string | null } | null;
  timezoneName?: string | null;
  timezoneNameAbbreviation?: string | null;
  daysLeft?: number | null;
};

type EsmGrid = { data?: EsmEvent[]; totalCount?: number };

export interface SouthDakotaSyncResult {
  stateCode: "SD";
  sourceName: string;
  ok: boolean;
  sourceCount: number;
  rowsFetched: number;
  actionableRows: number;
  complete: boolean;
  stored: number;
  newRecords: number;
  changedRecords: number;
  closedRecords: number;
  error?: string;
}

function centralTimeIso(value?: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?$/);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const [, date, time] = match;
  const probe = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    timeZoneName: "longOffset",
  }).formatToParts(probe);
  const offset = parts.find(part => part.type === "timeZoneName")?.value.replace("GMT", "") || "-06:00";
  return new Date(`${date}T${time}${offset}`).toISOString();
}

function solicitationType(id?: string | null) {
  const value = String(id || "").toUpperCase();
  if (value.includes("RFP")) return "RFP";
  if (value.includes("IFB")) return "IFB";
  if (value.includes("RFQ")) return "RFQ";
  if (value.includes("SOI")) return "SOI";
  if (value.includes("PRO")) return "Prospectus";
  return "Solicitation";
}

function sourceUrl(eventId: string) {
  return `https://postingboard.esmsolutions.com/${BOARD_ID}/eventDetail/${encodeURIComponent(eventId)}`;
}

async function fetchCurrentEvents() {
  const url = new URL(API_URL);
  url.searchParams.set("pageNo", "0");
  url.searchParams.set("recordsPerPage", "1000");
  url.searchParams.set("browserGlobalTimeZoneNameId", "Central Standard Time");
  url.searchParams.set("browserGlobalTimeZoneName", "America/Chicago");
  url.searchParams.set("browserOffset", "-05:00:00");

  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json", "user-agent": UA, referer: BOARD_URL },
  });
  if (!response.ok) throw new Error(`South Dakota ESM current events returned ${response.status}`);

  const payload = (await response.json()) as EsmGrid;
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const sourceCount = Number(payload.totalCount);
  if (!Number.isFinite(sourceCount) || sourceCount < 0) throw new Error("South Dakota ESM returned invalid totalCount");

  const ids = rows.map(row => String(row.eventId || "").trim()).filter(Boolean);
  const unique = new Set(ids);
  if (rows.length !== sourceCount || ids.length !== sourceCount || unique.size !== sourceCount) {
    throw new Error(`South Dakota ESM reconciliation failed: count=${sourceCount}, rows=${rows.length}, ids=${ids.length}, unique=${unique.size}`);
  }
  return { sourceCount, rows };
}

export async function syncSouthDakotaEsm(): Promise<SouthDakotaSyncResult> {
  try {
    const { sourceCount, rows } = await fetchCurrentEvents();
    const records: SledOpportunityRecord[] = rows.map(row => {
      const eventId = String(row.eventId).trim();
      const solicitationId = String(row.id || eventId).trim();
      return {
        externalId: eventId,
        agency: {
          key: "south-dakota-central-bid-exchange",
          name: "State of South Dakota",
          agencyType: "state_agency",
          jurisdictionLevel: "state",
          stateCode: "SD",
          website: BOARD_URL,
        },
        title: row.eventName?.trim() || solicitationId,
        description: null,
        solicitationType: solicitationType(row.id),
        procurementMechanism: "South Dakota Central Bid Exchange / ESM public posting board",
        status: "open",
        issueDate: centralTimeIso(row.publishedDate),
        dueAt: centralTimeIso(row.eventDueDate),
        stateCode: "SD",
        sourceUrl: sourceUrl(eventId),
        rawPayload: {
          platform: "South Dakota Central Bid Exchange / ESM Solutions",
          eventId,
          solicitationId,
          invitationType: row.invitationType?.description || null,
          eventStatus: row.status?.description || null,
          timezoneName: row.timezoneName || null,
          timezoneNameAbbreviation: row.timezoneNameAbbreviation || null,
          officialBoard: BOARD_URL,
        },
      };
    });

    const persisted = await persistSledOpportunities(SOURCE, records, {
      mode: "south_dakota_esm_current_refresh",
      recordChanges: true,
      closeMissing: true,
    });

    return {
      stateCode: "SD",
      sourceName: SOURCE.sourceName,
      ok: true,
      sourceCount,
      rowsFetched: rows.length,
      actionableRows: records.length,
      complete: true,
      ...persisted,
    };
  } catch (error) {
    return {
      stateCode: "SD",
      sourceName: SOURCE.sourceName,
      ok: false,
      sourceCount: 0,
      rowsFetched: 0,
      actionableRows: 0,
      complete: false,
      stored: 0,
      newRecords: 0,
      changedRecords: 0,
      closedRecords: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
