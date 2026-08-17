import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const DATASET = "T1SO_SRCH_QRY";
const GRID_KEY = "vss.page.VVSSX10019.gridView1.group1.cardGrid.grid1";
const PAGINATION_KEY = `${GRID_KEY}pagination`;
const MAX_PAGES = 200;

const PORTALS = [
  { state: "KY", name: "Kentucky VSS", url: "https://vss.ky.gov/vssprod-ext/Advantage4" },
  { state: "MI", name: "Michigan SIGMA VSS", url: "https://sigma.michigan.gov/PRDVSS1X1/Advantage4" },
];

type Obj = Record<string, any>;

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
    if (char === '"') { inString = true; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error("CGI initial JSON was not balanced");
}

function parseInitial(html: string): Obj {
  const marker = html.search(/var\s+moInitialResponse\s*=\s*/i);
  if (marker < 0) throw new Error("moInitialResponse was not found");
  const brace = html.indexOf("{", marker);
  if (brace < 0) throw new Error("moInitialResponse JSON start was not found");
  return JSON.parse(extractJsonObject(html, brace));
}

function cookieHeader(setCookie: string | null) {
  if (!setCookie) return "";
  return setCookie.split(/,(?=[^;,]+=)/).map(part => part.split(";")[0].trim()).filter(Boolean).join("; ");
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

function findByName(value: unknown, name: string): Obj | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findByName(item, name);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const object = value as Obj;
  if (object.name === name) return object;
  for (const child of Object.values(object)) {
    const found = findByName(child, name);
    if (found) return found;
  }
  return null;
}

function pageOpenAction(nav: Obj) {
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

async function postState(referer: string, state: Obj, action: Obj, cookie: string) {
  const response = await fetch(referer, {
    method: "POST",
    headers: {
      accept: "application/json,text/plain,*/*",
      "content-type": "application/json;charset=UTF-8",
      referer,
      origin: new globalThis.URL(referer).origin,
      ...(state.session_info?.csrf_token ? { "x-csrf-token": String(state.session_info.csrf_token) } : {}),
      ...(cookie ? { cookie } : {}),
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    body: JSON.stringify({ action, session_info: state.session_info, data: state.data }),
    redirect: "follow",
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`CGI action ${action.actionCode || action.actionType} returned ${response.status}: ${text.slice(0, 300)}`);
  let json: Obj;
  try { json = JSON.parse(text); } catch { throw new Error(`CGI action returned non-JSON: ${text.slice(0, 300)}`); }
  return { state: json, cookie: mergeCookies(cookie, response.headers.get("set-cookie")) };
}

async function openSolicitations(portal: (typeof PORTALS)[number]) {
  const initialResponse = await fetch(portal.url, {
    headers: { accept: "text/html,*/*", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    redirect: "follow",
    cache: "no-store",
  });
  if (!initialResponse.ok) throw new Error(`${portal.name} returned ${initialResponse.status}`);
  const initial = parseInitial(await initialResponse.text());
  let cookie = cookieHeader(initialResponse.headers.get("set-cookie"));
  const carouselNav = findByName(initial, "carousalAction");
  if (!carouselNav) throw new Error(`${portal.name} carousel action was not found`);
  const carousel = await postState(initialResponse.url, initial, pageOpenAction(carouselNav), cookie);
  cookie = carousel.cookie;
  const solicitationNav = findByName(carousel.state, "solicitations");
  if (!solicitationNav) throw new Error(`${portal.name} solicitations action was not found`);
  const solicitations = await postState(initialResponse.url, carousel.state, pageOpenAction(solicitationNav), cookie);
  return { referer: initialResponse.url, state: solicitations.state, cookie: solicitations.cookie };
}

function dataset(state: Obj) {
  return state.data?.ds_data?.[DATASET] || {};
}

function rows(state: Obj): Obj[] {
  const value = dataset(state).row_data;
  return Array.isArray(value) ? value : [];
}

function externalId(row: Obj) {
  const displayed = String(row.DOC_REF || "");
  const bracketed = displayed.match(/\[([^\]]+)\]\s*$/)?.[1];
  return bracketed || String(row.DOC_CD_CONCAT || row.ADV_ROW_ID || displayed || "").trim();
}

function windowInfo(state: Obj) {
  const ds = dataset(state);
  return {
    start: Number(ds.start_data_window || 0),
    end: Number(ds.end_data_window || 0),
    rowsPerPage: Number(ds.rows_per_page || 0),
    rowsTotal: Number(ds.rows_total || 0),
    suffix: String(ds.total_count_suffix || ""),
  };
}

async function sweep(portal: (typeof PORTALS)[number]) {
  const opened = await openSolicitations(portal);
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

  const unique = new Map<string, Obj>();
  const windows: Array<{ start: number; end: number; rows: number; suffix: string }> = [];
  let complete = false;
  let stopReason = "max_pages";

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const currentRows = rows(state);
    const info = windowInfo(state);
    for (const row of currentRows) {
      const id = externalId(row);
      if (id) unique.set(id, row);
    }
    windows.push({ start: info.start, end: info.end, rows: currentRows.length, suffix: info.suffix });

    if (info.suffix !== "+") {
      complete = true;
      stopReason = "source_exhausted";
      break;
    }
    if (!currentRows.length || !info.end) {
      stopReason = "empty_window_with_more_marker";
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
      break;
    }
    state = next.state;
    cookie = next.cookie;
  }

  return {
    state: portal.state,
    source: portal.name,
    complete,
    stopReason,
    uniqueRows: unique.size,
    finalWindow: windowInfo(state),
    windows,
    sample: [...unique.entries()].slice(0, 5).map(([id, row]) => ({
      id,
      description: row.DOC_DSCR || null,
      department: row.DEPT_NM || null,
      buyer: row.BUYR_NM || null,
      closing: row.SO_CLSNG_DT_TM || null,
    })),
  };
}

export async function GET() {
  const results = [];
  for (const portal of PORTALS) {
    try { results.push(await sweep(portal)); }
    catch (error) { results.push({ state: portal.state, complete: false, error: error instanceof Error ? error.message : String(error) }); }
  }
  return NextResponse.json({ ok: results.every(result => result.complete), results });
}
