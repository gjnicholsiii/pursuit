import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const ROOT = "https://procurement.staars.alabama.gov";
const ENTRY = `${ROOT}/PRDVSS1X1/AltSelfService`;
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";
const MAX_PAGES = 100;

const SOURCE: SledSourceConfig = {
  adapterKey: "cgi_advantage_legacy_al",
  sourceName: "Alabama STAARS Vendor Self Service",
  baseUrl: ENTRY,
  jurisdiction: "Alabama",
  sourceType: "portal",
};

export interface AlabamaSyncResult {
  stateCode: "AL";
  sourceName: string;
  ok: boolean;
  rowsFound: number;
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

function hiddenParams(html: string, formName?: string) {
  const $ = load(html);
  const form = formName ? $(`form[name='${formName}']`).first() : $("form").first();
  const params = new URLSearchParams();
  form.find("input[type='hidden']").each((_, input) => {
    const name = $(input).attr("name");
    if (name) params.append(name, $(input).attr("value") || "");
  });
  return params;
}

async function post(params: URLSearchParams, cookies: string[], referer: string) {
  return fetch(ENTRY, {
    method: "POST",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
      referer,
      origin: ROOT,
      ...(cookies.length ? { cookie: cookies.join("; ") } : {}),
    },
    body: params.toString(),
    redirect: "follow",
    cache: "no-store",
  });
}

function documentRefs(html: string) {
  const match = html.match(/var\s+lsDocReference\s*=\s*\[([^\]]*)\]/i);
  return match ? [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(item => text(item[1])).filter(Boolean) : [];
}

function nextDisabled(html: string) {
  const $ = load(html);
  const next = $("input[name='T1SO_SRCH_QRYnextpage']").first();
  return !next.length || next.attr("disabled") !== undefined || /disabled/i.test(next.attr("class") || "");
}

function parseCentral(value: string) {
  const cleaned = text(value).replace(/\bCDT\b|\bCST\b/i, "").trim();
  if (!cleaned) return null;
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i);
  if (!match) {
    const date = new Date(cleaned);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  let hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const meridiem = (match[6] || "").toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  const desiredAsUtc = Date.UTC(year, Number(match[1]) - 1, Number(match[2]), hour, minute, 0);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  let utcMillis = desiredAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(utcMillis)).map(part => [part.type, part.value]));
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    utcMillis = desiredAsUtc - (observed - utcMillis);
  }
  return new Date(utcMillis).toISOString();
}

function classifyAgency(name: string) {
  const normalized = name.toLowerCase();
  if (/school|education|academy/.test(normalized)) return { agencyType: "k12", jurisdictionLevel: "state" };
  if (/university|college/.test(normalized)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/county/.test(normalized)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/city|town|municipal/.test(normalized)) return { agencyType: "municipality", jurisdictionLevel: "local" };
  if (/authority|commission|district/.test(normalized)) return { agencyType: "authority", jurisdictionLevel: "state" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

function parsePage(html: string) {
  const $ = load(html);
  const rows = $("tr[rowcurrency]").toArray();
  const refs = documentRefs(html);
  if (refs.length !== rows.length) throw new Error(`Alabama VSS row/reference mismatch: ${rows.length} rows / ${refs.length} references`);

  return rows.map((row, index): SledOpportunityRecord | null => {
    const cells = $(row).children("td");
    if (cells.length < 4) return null;
    const firstLines = cells.eq(0).find("> table > tbody > tr, > table > tr").toArray().map(item => text($(item).text())).filter(Boolean);
    const title = firstLines[0] || "";
    const solicitationLine = firstLines[1] || "";
    const agencyLines = cells.eq(1).find("> table > tbody > tr, > table > tr").toArray().map(item => text($(item).text())).filter(Boolean);
    const agencyName = agencyLines[0] || "State of Alabama";
    const buyer = agencyLines[1] || null;
    const solicitationType = agencyLines.at(-1) || solicitationLine.split("-")[0]?.trim() || "Solicitation";
    const dateText = text(cells.eq(2).text());
    const published = dateText.match(/Published On\s*:\s*([^A]+?)(?=Amended On|Closing On|Intent Posted On|$)/i)?.[1]?.trim() || "";
    const amended = dateText.match(/Amended On\s*:\s*([^C]+?)(?=Closing On|Intent Posted On|$)/i)?.[1]?.trim() || "";
    const closing = dateText.match(/Closing On\s*:\s*([^I]+?)(?=Intent Posted On|$)/i)?.[1]?.trim() || "";
    const status = text(cells.eq(3).text());
    const externalId = refs[index];
    if (!externalId || !title || !/^open$/i.test(status)) return null;
    const dueAt = parseCentral(closing);
    if (dueAt && new Date(dueAt).getTime() < Date.now()) return null;
    const agencyClass = classifyAgency(agencyName);
    return {
      externalId,
      agency: {
        key: `alabama-vss:${agencyName}`,
        name: agencyName,
        agencyType: agencyClass.agencyType,
        jurisdictionLevel: agencyClass.jurisdictionLevel,
        stateCode: "AL",
        website: ENTRY,
      },
      title,
      solicitationType,
      procurementMechanism: "Alabama STAARS CGI Advantage VSS public solicitation",
      status: "open",
      issueDate: parseCentral(published),
      dueAt,
      stateCode: "AL",
      sourceUrl: ENTRY,
      rawPayload: {
        platform: "Alabama STAARS CGI Advantage VSS AltSelfService",
        documentReference: externalId,
        solicitation: solicitationLine || null,
        agency: agencyName,
        buyer,
        solicitationType,
        publishedOn: published || null,
        amendedOn: amended || null,
        closingOn: closing || null,
        sourceStatus: status,
        sourcePage: ENTRY,
        completeSweep: true,
      },
    };
  }).filter((record): record is SledOpportunityRecord => Boolean(record));
}

async function establishOpenSession() {
  const first = await fetch(ENTRY, { headers: { accept: "text/html", "user-agent": UA }, redirect: "follow", cache: "no-store" });
  if (!first.ok) throw new Error(`Alabama VSS entry returned ${first.status}`);
  const firstHtml = await first.text();
  let cookies = cookiePairs(first);
  const login = hiddenParams(firstHtml, "login_form");
  login.set("guest_login", "Public Access");
  const guest = await post(login, cookies, first.url || ENTRY);
  if (!guest.ok) throw new Error(`Alabama VSS guest login returned ${guest.status}`);
  const guestHtml = await guest.text();
  cookies = mergeCookies(cookies, cookiePairs(guest));
  const $guest = load(guestHtml);
  const base = $guest("base").attr("href") || guest.url;
  const startupSrc = $guest("frame[name='Startup']").attr("src") || "";
  if (!startupSrc) throw new Error("Alabama VSS startup frame was not found");
  const startupUrl = new URL(startupSrc, base).toString();
  const startup = await fetch(startupUrl, { headers: { accept: "text/html", "user-agent": UA, referer: guest.url, ...(cookies.length ? { cookie: cookies.join("; ") } : {}) }, cache: "no-store" });
  if (!startup.ok) throw new Error(`Alabama VSS startup returned ${startup.status}`);
  const startupHtml = await startup.text();
  cookies = mergeCookies(cookies, cookiePairs(startup));
  const enter = hiddenParams(startupHtml, "StartupPage");
  enter.set("frame_name", "Display");
  enter.set("query_string", 'menu_action=menu_action&ams_action=13&ams_destination="pCombSolicitation_Search"&ams_whereclause=""&ams_framesetpagename=""&ams_framename="Display"&ams_applname="VSS"&&ams_orderbyclause=""&ams_pagecode="SOSRCH"');
  const search = await post(enter, cookies, startup.url);
  if (!search.ok) throw new Error(`Alabama VSS solicitation search returned ${search.status}`);
  const searchHtml = await search.text();
  cookies = mergeCookies(cookies, cookiePairs(search));
  const openParams = hiddenParams(searchHtml, "pCombSolicitation_Search");
  openParams.set("frame_name", "Display");
  openParams.set("query_string", "AMSBrowseOpenSolicit=AMSBrowseOpenSolicit");
  const open = await post(openParams, cookies, search.url);
  if (!open.ok) throw new Error(`Alabama VSS open solicitations returned ${open.status}`);
  return { html: await open.text(), cookies: mergeCookies(cookies, cookiePairs(open)) };
}

async function fetchCompleteSweep() {
  const session = await establishOpenSession();
  let html = session.html;
  let cookies = session.cookies;
  const records = new Map<string, SledOpportunityRecord>();
  let pagesFetched = 0;
  let complete = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const pageRecords = parsePage(html);
    if (!pageRecords.length) throw new Error(`Alabama VSS page ${page} returned no actionable open solicitation rows`);
    for (const record of pageRecords) records.set(record.externalId, record);
    pagesFetched = page;
    if (nextDisabled(html)) { complete = true; break; }
    const params = hiddenParams(html, "pCombSolicitation_Search");
    params.set("T1SO_SRCH_QRYnextpage", "Next");
    const next = await post(params, cookies, ENTRY);
    if (!next.ok) throw new Error(`Alabama VSS page ${page + 1} returned ${next.status}`);
    html = await next.text();
    cookies = mergeCookies(cookies, cookiePairs(next));
  }
  if (!complete) throw new Error(`Alabama VSS did not reach the final page within ${MAX_PAGES} pages`);
  return { records: [...records.values()], pagesFetched, complete };
}

export async function syncAlabamaStaarsVss(): Promise<AlabamaSyncResult> {
  try {
    const sweep = await fetchCompleteSweep();
    const persisted = await persistSledOpportunities(SOURCE, sweep.records, { mode: "alabama_staars_vss_refresh", recordChanges: true, closeMissing: true });
    return { stateCode: "AL", sourceName: SOURCE.sourceName, ok: true, rowsFound: sweep.records.length, pagesFetched: sweep.pagesFetched, complete: sweep.complete, ...persisted };
  } catch (error) {
    return { stateCode: "AL", sourceName: SOURCE.sourceName, ok: false, rowsFound: 0, pagesFetched: 0, complete: false, stored: 0, newRecords: 0, changedRecords: 0, closedRecords: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
