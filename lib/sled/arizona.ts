import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const PAGE_URL = "https://app.az.gov/page.aspx/en/rfp/request_browse_public";
const AJAX_URL = "https://app.az.gov/ajax.aspx/en/rfp/request_browse_public?ivControlUIDsAsync=body%3Ax%3Agrid%3Aupgrid";
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

const SOURCE: SledSourceConfig = {
  adapterKey: "ivalua_app_az",
  sourceName: "Arizona Procurement Portal (APP) Public Solicitations",
  baseUrl: PAGE_URL,
  jurisdiction: "Arizona",
  sourceType: "portal",
};

type RawRow = {
  internalId: string;
  code: string;
  title: string;
  publicationBegin: string;
  commodity: string;
  agencyName: string;
  status: string;
  remainingTime: string;
  begin: string;
  end: string;
};

export interface ArizonaSyncResult {
  stateCode: "AZ";
  sourceName: string;
  ok: boolean;
  totalReported: number;
  rowsFetched: number;
  actionableRows: number;
  staleOpenRows: number;
  pagesFetched: number;
  complete: boolean;
  stored: number;
  newRecords: number;
  changedRecords: number;
  closedRecords: number;
  error?: string;
}

function text(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function cookiePairs(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : [])
    .map(value => value.split(";", 1)[0])
    .filter(Boolean);
}

function mergeCookies(existing: string[], incoming: string[]) {
  const map = new Map<string, string>();
  for (const pair of [...existing, ...incoming]) {
    const at = pair.indexOf("=");
    if (at > 0) map.set(pair.slice(0, at), pair);
  }
  return [...map.values()];
}

function formParams(html: string) {
  const $ = load(html);
  const form = new URLSearchParams();
  $("#mainForm input[name], #mainForm select[name], #mainForm textarea[name]").each((_, element) => {
    const node = $(element);
    const name = node.attr("name");
    if (!name) return;
    const tag = element.tagName.toLowerCase();
    const type = (node.attr("type") || "").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !node.attr("checked")) return;
    if (tag === "select") {
      const selected = node.find("option[selected]").first();
      form.set(name, selected.length ? selected.attr("value") || "" : node.find("option").first().attr("value") || "");
    } else {
      form.set(name, node.attr("value") || node.text() || "");
    }
  });
  return form;
}

function cleanAgency(value: string) {
  const name = text(value);
  if (!name) return "State of Arizona";
  if (name.length % 2 === 0) {
    const half = name.length / 2;
    if (name.slice(0, half) === name.slice(half)) return name.slice(0, half);
  }
  return name;
}

function classifyAgency(name: string) {
  const normalized = name.toLowerCase();
  if (/school|academy|school district|\bisd\b/.test(normalized)) return { agencyType: "k12", jurisdictionLevel: "local" };
  if (/university|college|community college|board of regents/.test(normalized)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/county/.test(normalized)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/city|town|municipal|tribe|tribal|indian community/.test(normalized)) return { agencyType: "municipality", jurisdictionLevel: "local" };
  if (/authority|commission|district|airport/.test(normalized)) return { agencyType: "authority", jurisdictionLevel: "local" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

function parseArizona(value: string) {
  const cleaned = text(value);
  if (!cleaned || /^1\/1\/0001\b/.test(cleaned)) return null;
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    const date = new Date(cleaned);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  let hour = Number(match[4]);
  const meridiem = match[7].toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  const year = Number(match[3]);
  const month = String(Number(match[1])).padStart(2, "0");
  const day = String(Number(match[2])).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  return new Date(`${year}-${month}-${day}T${hh}:${match[5]}:${match[6]}-07:00`).toISOString();
}

function parsePage(html: string) {
  const $ = load(html);
  const rows: RawRow[] = [];
  $("#body_x_grid_grd tbody tr").each((_, row) => {
    const cells = $(row).children("td").toArray().map(cell => text($(cell).text()));
    const link = $(row).find("a[href*='/bpm/process_manage_extranet/']").first();
    const href = link.attr("href") || "";
    const internalId = href.match(/\/bpm\/process_manage_extranet\/(\d+)/)?.[1] || "";
    const code = cells[1] || "";
    const title = cells[2] || text(link.text()).replace(/^Edit\s+/i, "");
    if (!internalId || !code || !title) return;
    rows.push({
      internalId,
      code,
      title,
      publicationBegin: cells[3] || "",
      commodity: cells[4] || "",
      agencyName: cleanAgency(cells[5] || ""),
      status: cells[7] || "",
      remainingTime: cells[9] || "",
      begin: cells[10] || "",
      end: cells[11] || "",
    });
  });
  return {
    currentPage: Number($("#hdnCurrentPageIndexbody_x_grid_grd").attr("value") || 0),
    totalRows: Number($("#hdnRowCountbody_x_grid_grd").attr("value") || 0),
    maxPage: Number($("#maxpageindexbody_x_grid_grd").attr("value") || 0),
    statusValue: $("#body_x_selStatusCode_1").attr("value") || "",
    rows,
  };
}

async function applyOpenFilter(initialHtml: string, cookies: string[]) {
  const form = formParams(initialHtml);
  form.set("body:x:selStatusCode_1", "val");
  form.set("body_x_selStatusCode_1_text", "Open for Bidding");
  form.set("body:x:prxFilterBar:x:cmdSearchBtn", "Search");
  form.delete("__EVENTTARGET");
  form.delete("__EVENTARGUMENT");
  const response = await fetch(PAGE_URL, {
    method: "POST",
    headers: {
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
      origin: "https://app.az.gov",
      referer: PAGE_URL,
      ...(cookies.length ? { cookie: cookies.join("; ") } : {}),
    },
    body: form.toString(),
    cache: "no-store",
    redirect: "follow",
  });
  const html = await response.text();
  if (!response.ok) throw new Error(`Arizona APP open filter returned ${response.status}`);
  return { html, cookies: mergeCookies(cookies, cookiePairs(response)) };
}

async function fetchGridPage(pageIndex: number, html: string, cookies: string[]) {
  const form = formParams(html);
  form.set("__EVENTTARGET", "body_x_grid_grd");
  form.set("__EVENTARGUMENT", `Page|${pageIndex}`);
  const response = await fetch(AJAX_URL, {
    method: "POST",
    headers: {
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": UA,
      referer: PAGE_URL,
      "x-requested-with": "XMLHttpRequest",
      "IV-AjaxControl": "gridview",
      "IV-AjaxControl-ID": "body_x_grid_grd",
      ...(cookies.length ? { cookie: cookies.join("; ") } : {}),
    },
    body: form.toString(),
    cache: "no-store",
    redirect: "follow",
  });
  const nextHtml = await response.text();
  if (!response.ok) throw new Error(`Arizona APP page ${pageIndex + 1} returned ${response.status}`);
  return { html: nextHtml, cookies: mergeCookies(cookies, cookiePairs(response)) };
}

async function fetchCompleteOpenSweep() {
  const first = await fetch(PAGE_URL, {
    headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8", "user-agent": UA },
    cache: "no-store",
    redirect: "follow",
  });
  if (!first.ok) throw new Error(`Arizona APP initial page returned ${first.status}`);
  const initialHtml = await first.text();
  let cookies = cookiePairs(first);
  const filtered = await applyOpenFilter(initialHtml, cookies);
  let html = filtered.html;
  cookies = filtered.cookies;
  const firstPage = parsePage(html);
  if (firstPage.statusValue !== "val") throw new Error(`Arizona APP open filter did not persist; received ${firstPage.statusValue || "blank"}`);
  if (!firstPage.totalRows) throw new Error("Arizona APP open filter returned zero source rows");

  const pages = [firstPage];
  for (let pageIndex = 1; pageIndex <= firstPage.maxPage; pageIndex += 1) {
    const next = await fetchGridPage(pageIndex, html, cookies);
    html = next.html;
    cookies = next.cookies;
    const parsed = parsePage(html);
    if (parsed.currentPage !== pageIndex) throw new Error(`Arizona APP expected page ${pageIndex}, received ${parsed.currentPage}`);
    if (parsed.statusValue !== "val") throw new Error(`Arizona APP lost Open for Bidding filter on page ${pageIndex + 1}`);
    pages.push(parsed);
  }

  const rawRows = pages.flatMap(page => page.rows);
  const unique = new Map(rawRows.map(row => [row.internalId, row]));
  if (rawRows.length !== firstPage.totalRows || unique.size !== firstPage.totalRows) {
    throw new Error(`Arizona APP incomplete open sweep: reported ${firstPage.totalRows}, fetched ${rawRows.length}, unique ${unique.size}`);
  }
  if ([...unique.values()].some(row => row.status !== "Open for Bidding")) {
    throw new Error("Arizona APP open-only sweep contained a non-open status");
  }

  return { rows: [...unique.values()], totalReported: firstPage.totalRows, pagesFetched: pages.length };
}

function normalizeRow(row: RawRow): SledOpportunityRecord | null {
  const dueAt = parseArizona(row.end);
  if (dueAt && new Date(dueAt).getTime() < Date.now()) return null;
  const issueDate = parseArizona(row.publicationBegin) || parseArizona(row.begin);
  const agency = classifyAgency(row.agencyName);
  return {
    externalId: row.code,
    agency: {
      key: `arizona-app:${row.agencyName}`,
      name: row.agencyName,
      agencyType: agency.agencyType,
      jurisdictionLevel: agency.jurisdictionLevel,
      stateCode: "AZ",
      website: PAGE_URL,
    },
    title: row.title,
    solicitationType: "Solicitation",
    procurementMechanism: "Arizona Procurement Portal Ivalua public solicitation",
    status: "open",
    issueDate,
    dueAt,
    stateCode: "AZ",
    sourceUrl: `https://app.az.gov/page.aspx/en/bpm/process_manage_extranet/${row.internalId}`,
    rawPayload: {
      platform: "Arizona Procurement Portal / Ivalua",
      internalId: row.internalId,
      code: row.code,
      commodity: row.commodity || null,
      agency: row.agencyName,
      sourceStatus: row.status,
      publicationBegin: row.publicationBegin || null,
      begin: row.begin || null,
      end: row.end || null,
      completeOpenSweep: true,
    },
  };
}

export async function syncArizonaApp(): Promise<ArizonaSyncResult> {
  try {
    const sweep = await fetchCompleteOpenSweep();
    const records = sweep.rows.map(normalizeRow).filter((record): record is SledOpportunityRecord => Boolean(record));
    const persisted = await persistSledOpportunities(SOURCE, records, {
      mode: "arizona_app_open_refresh",
      recordChanges: true,
      closeMissing: true,
    });
    return {
      stateCode: "AZ",
      sourceName: SOURCE.sourceName,
      ok: true,
      totalReported: sweep.totalReported,
      rowsFetched: sweep.rows.length,
      actionableRows: records.length,
      staleOpenRows: sweep.rows.length - records.length,
      pagesFetched: sweep.pagesFetched,
      complete: true,
      ...persisted,
    };
  } catch (error) {
    return {
      stateCode: "AZ",
      sourceName: SOURCE.sourceName,
      ok: false,
      totalReported: 0,
      rowsFetched: 0,
      actionableRows: 0,
      staleOpenRows: 0,
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
