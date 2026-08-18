import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const ROOT = "https://evp.nc.gov";
const PAGE = `${ROOT}/solicitations/?status=0`;
const TOKEN = `${ROOT}/_layout/tokenhtml`;
const LIST_ID = "863ea987-6d3e-ed11-9daf-001dd805ec0b";
const GRID = `${ROOT}/_services/entity-grid-data.json/${LIST_ID}`;
const OPEN_META_FILTER = "3=0";
const PAGE_SIZE = 10;
const BATCH_SIZE = 6;
const USER_AGENT = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

const SOURCE: SledSourceConfig = {
  adapterKey: "powerpages_nc",
  sourceName: "North Carolina electronic Vendor Portal (eVP)",
  baseUrl: PAGE,
  jurisdiction: "North Carolina",
  sourceType: "portal",
};

export interface NorthCarolinaSyncResult {
  stateCode: "NC";
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  totalReported: number | null;
  pagesFetched: number;
  complete: boolean;
  stored: number;
  newRecords: number;
  changedRecords: number;
  closedRecords: number;
  error?: string;
}

type PowerPagesAttribute = {
  Name?: string;
  Value?: unknown;
  FormattedValue?: unknown;
  DisplayValue?: unknown;
};

type PowerPagesRecord = {
  Id?: string;
  EntityName?: string;
  Attributes?: PowerPagesAttribute[];
};

type GridResponse = {
  MoreRecords?: boolean;
  Records?: PowerPagesRecord[];
  ItemCount?: number;
  PageCount?: number;
  PageNumber?: number;
  PageSize?: number;
};

function text(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function cookiePairs(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(value => value.split(";", 1)[0]).filter(Boolean);
}

function mergeCookies(...sets: string[][]) {
  const map = new Map<string, string>();
  for (const set of sets) for (const pair of set) {
    const eq = pair.indexOf("=");
    if (eq > 0) map.set(pair.slice(0, eq), pair);
  }
  return [...map.values()];
}

function extractToken(html: string) {
  const $ = load(html);
  const direct = $("input[name='__RequestVerificationToken']").attr("value") || $("input[id='__RequestVerificationToken']").attr("value");
  if (direct) return direct.trim();
  const match = html.match(/value=["']([^"']+)["'][^>]*(?:name|id)=["']__RequestVerificationToken["']|(?:name|id)=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)/i);
  return (match?.[1] || match?.[2] || "").trim();
}

function decodeLayouts(value: string) {
  const candidates = [value];
  try { candidates.push(decodeURIComponent(value)); } catch {}
  candidates.push(value.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, "&"));
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch {}
    try { return JSON.parse(Buffer.from(candidate, "base64").toString("utf8")); } catch {}
  }
  return null;
}

function attr(record: PowerPagesRecord, name: string) {
  return (record.Attributes || []).find(item => item?.Name === name);
}

function attrValue(record: PowerPagesRecord, name: string) {
  const item = attr(record, name);
  if (!item) return "";
  for (const candidate of [item.DisplayValue, item.FormattedValue, item.Value]) {
    if (candidate === null || candidate === undefined) continue;
    if (typeof candidate === "object") {
      const object = candidate as Record<string, unknown>;
      const nested = object.Name ?? object.name ?? object.Value ?? object.value;
      if (nested !== null && nested !== undefined) return text(nested);
      continue;
    }
    const value = text(candidate);
    if (value) return value;
  }
  return "";
}

function stripMarkup(value: string) {
  if (!/[<>]/.test(value)) return text(value);
  return text(load(`<div>${value}</div>`)("div").text());
}

function easternTimestamp(value: string) {
  const cleaned = text(value);
  if (!cleaned) return null;
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (!match) {
    const parsed = new Date(cleaned);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  let hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  const meridiem = (match[7] || "").toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  let utcMillis = desiredAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(utcMillis)).map(part => [part.type, part.value]));
    const observedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    utcMillis = desiredAsUtc - (observedAsUtc - utcMillis);
  }
  return new Date(utcMillis).toISOString();
}

function classifyAgency(name: string) {
  const n = name.toLowerCase();
  if (/school|board of education|public schools|academy/.test(n)) return { agencyType: "k12", jurisdictionLevel: "local" };
  if (/university|college|community college/.test(n)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/\bcounty\b/.test(n)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/\bcity\b|\btown\b|\bvillage\b|municipal/.test(n)) return { agencyType: "municipality", jurisdictionLevel: "local" };
  if (/authority|commission|district/.test(n)) return { agencyType: "authority", jurisdictionLevel: "state" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

function inferType(title: string, description: string) {
  const combined = `${title} ${description}`.toLowerCase();
  if (/request for information|\brfi\b/.test(combined)) return "RFI";
  if (/request for qualifications|\brfq\b/.test(combined)) return "RFQ";
  if (/request for proposal|\brfp\b/.test(combined)) return "RFP";
  if (/invitation for bid|invitation to bid|\bifb\b|\bitb\b/.test(combined)) return "IFB";
  return "Public procurement notice";
}

function detailUrl(id: string) {
  return `${ROOT}/solicitations/details/?id=${encodeURIComponent(id)}`;
}

function parseRecord(record: PowerPagesRecord): SledOpportunityRecord | null {
  const id = text(record.Id);
  const title = attrValue(record, "evp_name");
  const solicitationNumber = attrValue(record, "evp_solicitationnbr") || attrValue(record, "evp_solicitationid");
  const agencyName = attrValue(record, "owningbusinessunit") || "North Carolina Public Agency";
  const statusReason = attrValue(record, "statuscode");
  const postedText = attrValue(record, "evp_posteddate");
  const openText = attrValue(record, "evp_opendate");
  const description = stripMarkup(attrValue(record, "evp_description"));
  if (!id || !title || !/^open$/i.test(statusReason)) return null;

  const agencyClass = classifyAgency(agencyName);
  return {
    externalId: id,
    agency: {
      key: `north-carolina:${agencyName}`,
      name: agencyName,
      agencyType: agencyClass.agencyType,
      jurisdictionLevel: agencyClass.jurisdictionLevel,
      stateCode: "NC",
      website: ROOT,
    },
    title,
    description: description || null,
    solicitationType: inferType(title, description),
    procurementMechanism: "North Carolina eVP public solicitation",
    status: "open",
    issueDate: easternTimestamp(postedText),
    dueAt: easternTimestamp(openText),
    stateCode: "NC",
    sourceUrl: detailUrl(id),
    rawPayload: {
      platform: "North Carolina electronic Vendor Portal / Microsoft Power Pages",
      recordId: id,
      solicitationNumber: solicitationNumber || null,
      title,
      agency: agencyName,
      status: statusReason,
      postedDate: postedText || null,
      openingDate: openText || null,
      description: description || null,
      sourcePage: detailUrl(id),
    },
  };
}

async function establishSession() {
  const pageResponse = await fetch(PAGE, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT },
    redirect: "follow",
    cache: "no-store",
  });
  if (!pageResponse.ok) throw new Error(`North Carolina eVP page returned ${pageResponse.status}`);
  const pageHtml = await pageResponse.text();
  const pageCookies = cookiePairs(pageResponse);

  const tokenResponse = await fetch(TOKEN, {
    headers: {
      accept: "text/html,*/*",
      "user-agent": USER_AGENT,
      referer: PAGE,
      ...(pageCookies.length ? { cookie: pageCookies.join("; ") } : {}),
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!tokenResponse.ok) throw new Error(`North Carolina eVP token endpoint returned ${tokenResponse.status}`);
  const token = extractToken(await tokenResponse.text());
  if (!token) throw new Error("North Carolina eVP antiforgery token was not found");
  const cookies = mergeCookies(pageCookies, cookiePairs(tokenResponse));

  const $ = load(pageHtml);
  const grid = $(".entity-grid").first();
  const selectedView = grid.attr("data-selected-view") || "";
  const layouts = decodeLayouts(grid.attr("data-view-layouts") || "");
  const list = Array.isArray(layouts) ? layouts : [];
  const active = list.find((entry: any) => String(entry?.Id || "").toLowerCase() === selectedView.toLowerCase()) || list[0] || null;
  const secure = active?.Base64SecureConfiguration || "";
  if (!secure) throw new Error("North Carolina eVP secure grid configuration was not found");
  const sortExpression = active?.SortExpression || "evp_posteddate DESC,evp_solicitationnumber DESC";
  return { token, cookies, secure, sortExpression };
}

async function fetchGridPage(session: Awaited<ReturnType<typeof establishSession>>, page: number) {
  const response = await fetch(GRID, {
    method: "POST",
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/json; charset=UTF-8",
      "user-agent": USER_AGENT,
      referer: PAGE,
      "x-requested-with": "XMLHttpRequest",
      __RequestVerificationToken: session.token,
      ...(session.cookies.length ? { cookie: session.cookies.join("; ") } : {}),
    },
    body: JSON.stringify({
      base64SecureConfiguration: session.secure,
      sortExpression: session.sortExpression,
      search: null,
      filter: null,
      metaFilter: OPEN_META_FILTER,
      page,
      pageSize: PAGE_SIZE,
      timezoneOffset: 240,
      pcfFilter: "",
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`North Carolina eVP grid page ${page} returned ${response.status}`);
  return await response.json() as GridResponse;
}

async function fetchCompleteSweep() {
  const session = await establishSession();
  const first = await fetchGridPage(session, 1);
  const totalReported = Number(first.ItemCount ?? 0);
  const pageCount = Number(first.PageCount ?? 0);
  if (!totalReported || !pageCount || !Array.isArray(first.Records)) {
    throw new Error("North Carolina eVP returned no open solicitation grid records");
  }

  const pages = new Map<number, GridResponse>([[1, first]]);
  const remaining = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
  for (let offset = 0; offset < remaining.length; offset += BATCH_SIZE) {
    const batch = remaining.slice(offset, offset + BATCH_SIZE);
    const results = await Promise.all(batch.map(async page => [page, await fetchGridPage(session, page)] as const));
    for (const [page, result] of results) pages.set(page, result);
  }

  const rawRecords = Array.from(pages.entries())
    .sort(([a], [b]) => a - b)
    .flatMap(([, result]) => Array.isArray(result.Records) ? result.Records : []);
  const uniqueRaw = [...new Map(rawRecords.map(record => [text(record.Id), record])).values()].filter(record => text(record.Id));
  const records = uniqueRaw.map(parseRecord).filter((record): record is SledOpportunityRecord => Boolean(record));
  const complete = pages.size === pageCount && uniqueRaw.length === totalReported && records.length === totalReported;
  if (!complete) {
    throw new Error(`North Carolina completeness check failed: ${records.length} parsed / ${uniqueRaw.length} unique / ${totalReported} reported across ${pages.size}/${pageCount} pages`);
  }
  return { records, totalReported, pagesFetched: pages.size, complete };
}

export async function syncNorthCarolinaEvp(): Promise<NorthCarolinaSyncResult> {
  try {
    const sweep = await fetchCompleteSweep();
    const persisted = await persistSledOpportunities(SOURCE, sweep.records, {
      mode: "north_carolina_evp_refresh",
      recordChanges: true,
      closeMissing: true,
    });
    return {
      stateCode: "NC",
      sourceName: SOURCE.sourceName,
      ok: true,
      rowsFound: sweep.records.length,
      totalReported: sweep.totalReported,
      pagesFetched: sweep.pagesFetched,
      complete: sweep.complete,
      ...persisted,
    };
  } catch (error) {
    return {
      stateCode: "NC",
      sourceName: SOURCE.sourceName,
      ok: false,
      rowsFound: 0,
      totalReported: null,
      pagesFetched: 0,
      complete: false,
      stored: 0,
      newRecords: 0,
      changedRecords: 0,
      closedRecords: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
