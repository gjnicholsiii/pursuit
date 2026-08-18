import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const DATASET = "T1SO_SRCH_QRY";
const GRID_KEY = "vss.page.VVSSX10019.gridView1.group1.cardGrid.grid1";
const PAGINATION_KEY = `${GRID_KEY}pagination`;
const MAX_PAGES = 200;

type CgiObject = Record<string, any>;

interface CgiAdvantageConfig {
  stateCode: string;
  stateName: string;
  sourceName: string;
  portalUrl: string;
}

const CGI_ADVANTAGE_STATES: CgiAdvantageConfig[] = [
  {
    stateCode: "AK",
    stateName: "Alaska",
    sourceName: "Alaska IRIS Vendor Self Service",
    portalUrl: "https://iris-vss.alaska.gov/PRDVSS1X1/Advantage4",
  },
  {
    stateCode: "CO",
    stateName: "Colorado",
    sourceName: "Colorado Vendor Self Service",
    portalUrl: "https://prd.co.cgiadvantage.com/PRDVSS1X1/Advantage4",
  },
  {
    stateCode: "KY",
    stateName: "Kentucky",
    sourceName: "Kentucky Vendor Self Service",
    portalUrl: "https://vss.ky.gov/vssprod-ext/Advantage4",
  },
  {
    stateCode: "ME",
    stateName: "Maine",
    sourceName: "Maine Vendor Self Service",
    portalUrl: "https://mevss.hostams.com/PRDVSS1X1/AltSelfService",
  },
  {
    stateCode: "MI",
    stateName: "Michigan",
    sourceName: "Michigan SIGMA Vendor Self Service",
    portalUrl: "https://sigma.michigan.gov/PRDVSS1X1/Advantage4",
  },
  {
    stateCode: "WV",
    stateName: "West Virginia",
    sourceName: "West Virginia wvOASIS Vendor Self Service",
    portalUrl: "https://prd311.wvoasis.gov/PRDVSS1X1ERP/Advantage4",
  },
];

function extractJsonObject(source: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error("CGI Advantage initial JSON was not balanced");
}

function parseInitial(html: string): CgiObject {
  const marker = html.search(/var\s+moInitialResponse\s*=\s*/i);
  if (marker < 0) throw new Error("CGI Advantage moInitialResponse was not found");
  const brace = html.indexOf("{", marker);
  if (brace < 0) throw new Error("CGI Advantage initial JSON start was not found");
  return JSON.parse(extractJsonObject(html, brace)) as CgiObject;
}

function cookieHeader(setCookie: string | null) {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=[^;,]+=)/)
    .map(part => part.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function mergeCookies(existing: string, setCookie: string | null) {
  const values = new Map<string, string>();
  for (const header of [existing, cookieHeader(setCookie)]) {
    for (const item of header.split(";").map(value => value.trim()).filter(Boolean)) {
      const at = item.indexOf("=");
      if (at > 0) values.set(item.slice(0, at), item.slice(at + 1));
    }
  }
  return [...values].map(([key, value]) => `${key}=${value}`).join("; ");
}

function findByName(value: unknown, name: string): CgiObject | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findByName(item, name);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const object = value as CgiObject;
  if (object.name === name) return object;
  for (const child of Object.values(object)) {
    const found = findByName(child, name);
    if (found) return found;
  }
  return null;
}

function pageOpenAction(nav: CgiObject) {
  return {
    key: nav.key,
    actionType: "pageOpen",
    params: {
      targetLocation: nav.targetLocation,
      targetComponentType: nav.targetComponentType,
      isEntpriseSrchCreateAction: Boolean(nav.isEntpriseSrchCreateAction),
    },
    isCarouselNavigation: nav.isCarouselNavigation,
    targetQualifiedName: nav.targetQualifiedName,
    ...(nav.viewName ? { viewName: nav.viewName } : {}),
    suppressLeafing: Boolean(nav.suppressLeafing),
  };
}

async function postState(referer: string, state: CgiObject, action: CgiObject, cookie: string) {
  const response = await fetch(referer, {
    method: "POST",
    headers: {
      accept: "application/json,text/plain,*/*",
      "content-type": "application/json;charset=UTF-8",
      referer,
      origin: new URL(referer).origin,
      ...(state.session_info?.csrf_token ? { "x-csrf-token": String(state.session_info.csrf_token) } : {}),
      ...(cookie ? { cookie } : {}),
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    body: JSON.stringify({ action, session_info: state.session_info, data: state.data }),
    redirect: "follow",
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`CGI Advantage ${action.actionCode || action.actionType} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  try {
    return {
      state: JSON.parse(text) as CgiObject,
      cookie: mergeCookies(cookie, response.headers.get("set-cookie")),
    };
  } catch {
    throw new Error(`CGI Advantage action returned non-JSON: ${text.slice(0, 300)}`);
  }
}

async function openSolicitations(config: CgiAdvantageConfig) {
  const initialResponse = await fetch(config.portalUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!initialResponse.ok) throw new Error(`${config.sourceName} returned ${initialResponse.status}`);

  const initial = parseInitial(await initialResponse.text());
  let cookie = cookieHeader(initialResponse.headers.get("set-cookie"));
  const carouselNav = findByName(initial, "carousalAction");
  if (!carouselNav) throw new Error(`${config.sourceName} guest carousel action was not found`);
  const carousel = await postState(initialResponse.url, initial, pageOpenAction(carouselNav), cookie);
  cookie = carousel.cookie;

  const solicitationsNav = findByName(carousel.state, "solicitations");
  if (!solicitationsNav) throw new Error(`${config.sourceName} published solicitations action was not found`);
  const solicitations = await postState(initialResponse.url, carousel.state, pageOpenAction(solicitationsNav), cookie);
  return { referer: initialResponse.url, state: solicitations.state, cookie: solicitations.cookie };
}

function dataSet(state: CgiObject) {
  return state.data?.ds_data?.[DATASET] || {};
}

function sourceRows(state: CgiObject): CgiObject[] {
  const value = dataSet(state).row_data;
  return Array.isArray(value) ? value : [];
}

function windowInfo(state: CgiObject) {
  const ds = dataSet(state);
  return {
    start: Number(ds.start_data_window || 0),
    end: Number(ds.end_data_window || 0),
    rowsPerPage: Number(ds.rows_per_page || 0),
    rowsTotal: Number(ds.rows_total || 0),
    suffix: String(ds.total_count_suffix || ""),
  };
}

function solicitationId(row: CgiObject) {
  const displayed = String(row.DOC_REF || "").trim();
  const bracketed = displayed.match(/\[([^\]]+)\]\s*$/)?.[1];
  return (bracketed || String(row.DOC_CD_CONCAT || row.ADV_ROW_ID || displayed || "")).trim();
}

function timestamp(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function classifyAgency(name: string) {
  const normalized = name.toLowerCase();
  if (/school|public schools|academy|intermediate school district|\bisd\b/.test(normalized)) {
    return { agencyType: "k12", jurisdictionLevel: "local" };
  }
  if (/university|college|community college|higher education/.test(normalized)) {
    return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  }
  if (/county/.test(normalized)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/city|township|village|borough|municipal/.test(normalized)) {
    return { agencyType: "municipality", jurisdictionLevel: "local" };
  }
  if (/authority|commission|district|airport/.test(normalized)) {
    return { agencyType: "authority", jurisdictionLevel: "local" };
  }
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

function detailUrl(config: CgiAdvantageConfig, externalId: string) {
  const url = new URL(config.portalUrl);
  url.searchParams.set("solicitation_number", externalId);
  return url.toString();
}

function normalizeRow(config: CgiAdvantageConfig, row: CgiObject): SledOpportunityRecord | null {
  const externalId = solicitationId(row);
  const title = String(row.DOC_DSCR || "").trim();
  if (!externalId || !title) return null;

  const dueAt = timestamp(row.SO_CLSNG_DT_TM || row.PUB_BID_OP_DT);
  if (dueAt && new Date(dueAt).getTime() < Date.now()) return null;

  const agencyName = String(row.DEPT_NM || config.stateName).trim() || config.stateName;
  const agencyClass = classifyAgency(agencyName);
  const issueDate = timestamp(row.PUB_DT);
  const amendedAt = timestamp(row.AMND_DT);
  const bidOpeningAt = timestamp(row.PUB_BID_OP_DT);
  const solicitationType = String(row.DOC_CD || row.SO_CAT_CD || "Solicitation").trim();

  return {
    externalId,
    agency: {
      key: `cgi_advantage:${config.stateCode}:${agencyName}`,
      name: agencyName,
      agencyType: agencyClass.agencyType,
      jurisdictionLevel: agencyClass.jurisdictionLevel,
      stateCode: config.stateCode,
      website: config.portalUrl,
    },
    title,
    solicitationType,
    procurementMechanism: "CGI Advantage VSS public solicitation",
    status: "open",
    issueDate,
    dueAt,
    stateCode: config.stateCode,
    sourceUrl: detailUrl(config, externalId),
    rawPayload: {
      platform: "CGI Advantage VSS",
      state: config.stateName,
      solicitationNumber: externalId,
      category: row.SO_CAT_CD || null,
      sourceStatus: row.SO_STA || null,
      documentCode: row.DOC_CD || null,
      documentDescription: title,
      department: agencyName,
      buyer: row.BUYR_NM || null,
      buyerEmail: row.BUYR_EMAIL_AD || null,
      buyerPhone: row.BUYR_PH_NO || null,
      publishedAt: issueDate,
      amendedAt,
      closesAt: dueAt,
      bidOpeningAt,
      timeLeft: row.SO_TIME_LEFT || null,
      sourcePage: config.portalUrl,
      completeSweep: true,
    },
  };
}

async function fetchCompleteSweep(config: CgiAdvantageConfig) {
  const opened = await openSolicitations(config);
  let state = opened.state;
  let cookie = opened.cookie;

  const resized = await postState(opened.referer, state, {
    key: PAGINATION_KEY,
    actionType: "dsAction",
    actionCode: "show_lines",
    dsNameList: DATASET,
    form: "anchor",
    genericParam_1: "100",
    bypassPopupClose: false,
  }, cookie);
  state = resized.state;
  cookie = resized.cookie;

  const rawRows = new Map<string, CgiObject>();
  let complete = false;
  let stopReason = "max_pages";
  let pages = 0;
  let sourceRowsSeen = 0;

  for (; pages < MAX_PAGES; pages += 1) {
    const currentRows = sourceRows(state);
    const info = windowInfo(state);
    sourceRowsSeen += currentRows.length;
    for (const row of currentRows) {
      const id = solicitationId(row);
      if (id) rawRows.set(id, row);
    }

    if (info.suffix !== "+") {
      complete = true;
      stopReason = "source_exhausted";
      pages += 1;
      break;
    }
    if (!currentRows.length || !info.end) {
      stopReason = "empty_window_with_more_marker";
      pages += 1;
      break;
    }

    const previousEnd = info.end;
    const next = await postState(opened.referer, state, {
      key: PAGINATION_KEY,
      actionType: "dsAction",
      actionCode: "nextpage",
      dsNameList: DATASET,
      bypassPopupClose: false,
    }, cookie);
    const nextInfo = windowInfo(next.state);
    if (nextInfo.end <= previousEnd) {
      stopReason = "window_did_not_advance";
      state = next.state;
      cookie = next.cookie;
      pages += 1;
      break;
    }
    state = next.state;
    cookie = next.cookie;
  }

  const records = [...rawRows.values()]
    .map(row => normalizeRow(config, row))
    .filter((record): record is SledOpportunityRecord => Boolean(record));

  return {
    records,
    complete,
    stopReason,
    pages,
    sourceRowsSeen,
    sourceUniqueRows: rawRows.size,
    finalWindow: windowInfo(state),
  };
}

export async function syncCgiAdvantageFullSweeps() {
  const results = [];
  for (const config of CGI_ADVANTAGE_STATES) {
    try {
      const sweep = await fetchCompleteSweep(config);
      if (!sweep.complete) throw new Error(`${config.sourceName} incomplete sweep: ${sweep.stopReason}`);

      const source: SledSourceConfig = {
        adapterKey: `cgi_advantage_${config.stateCode.toLowerCase()}`,
        sourceName: config.sourceName,
        baseUrl: config.portalUrl,
        jurisdiction: config.stateName,
        sourceType: "portal",
      };
      const persisted = await persistSledOpportunities(source, sweep.records, {
        mode: "cgi_advantage_full_sweep",
        recordChanges: true,
        closeMissing: true,
      });
      results.push({
        stateCode: config.stateCode,
        ok: true,
        complete: true,
        sourceRowsSeen: sweep.sourceRowsSeen,
        sourceUniqueRows: sweep.sourceUniqueRows,
        rowsFound: sweep.records.length,
        pages: sweep.pages,
        ...persisted,
      });
    } catch (error) {
      results.push({
        stateCode: config.stateCode,
        ok: false,
        complete: false,
        sourceRowsSeen: 0,
        sourceUniqueRows: 0,
        rowsFound: 0,
        stored: 0,
        newRecords: 0,
        changedRecords: 0,
        closedRecords: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
