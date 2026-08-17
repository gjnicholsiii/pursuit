import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PORTAL = "https://vss.ky.gov/vssprod-ext/Advantage4";
const DATASET = "T1SO_SRCH_QRY";
const GRID_KEY = "vss.page.VVSSX10019.gridView1.group1.cardGrid.grid1";
type Obj = Record<string, any>;

function extractJsonObject(source: string, start: number) {
  let depth = 0, inString = false, escaped = false;
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
  throw new Error("JSON object was not balanced");
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
    for (const item of value) { const found = findByName(item, name); if (found) return found; }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const object = value as Obj;
  if (object.name === name) return object;
  for (const child of Object.values(object)) { const found = findByName(child, name); if (found) return found; }
  return null;
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
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST returned ${response.status}: ${text.slice(0, 350)}`);
  let json: Obj;
  try { json = JSON.parse(text); } catch { throw new Error(`POST returned non-JSON: ${text.slice(0, 350)}`); }
  return { state: json, cookie: mergeCookies(cookie, response.headers.get("set-cookie")), status: response.status };
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

async function openSolicitations() {
  const initialResponse = await fetch(PORTAL, {
    headers: { accept: "text/html,*/*", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    cache: "no-store",
  });
  if (!initialResponse.ok) throw new Error(`Kentucky VSS returned ${initialResponse.status}`);
  const initial = parseInitial(await initialResponse.text());
  let cookie = cookieHeader(initialResponse.headers.get("set-cookie"));
  const carouselNav = findByName(initial, "carousalAction");
  if (!carouselNav) throw new Error("carousalAction was not found");
  const carousel = await postState(initialResponse.url, initial, pageOpenAction(carouselNav), cookie);
  cookie = carousel.cookie;
  const solicitationNav = findByName(carousel.state, "solicitations");
  if (!solicitationNav) throw new Error("solicitations action was not found");
  const solicitations = await postState(initialResponse.url, carousel.state, pageOpenAction(solicitationNav), cookie);
  return { referer: initialResponse.url, state: solicitations.state, cookie: solicitations.cookie };
}

function summary(state: Obj) {
  const ds = state.data?.ds_data?.[DATASET] || {};
  const rows = Array.isArray(ds.row_data) ? ds.row_data : [];
  return {
    rows: rows.length,
    ids: rows.slice(0, 5).map((row: Obj) => row.DOC_REF || row.DOC_CD_CONCAT || row.ADV_ROW_ID || null),
    startDataWindow: ds.start_data_window ?? null,
    endDataWindow: ds.end_data_window ?? null,
    startPageWindow: ds.start_page_window ?? null,
    endPageWindow: ds.end_page_window ?? null,
    rowsPerPage: ds.rows_per_page ?? null,
    rowsTotal: ds.rows_total ?? null,
    totalCountSuffix: ds.total_count_suffix ?? null,
  };
}

async function testKey(key: string) {
  const opened = await openSolicitations();
  const before = summary(opened.state);
  try {
    const next = await postState(opened.referer, opened.state, {
      key,
      actionType: "dsAction",
      actionCode: "nextpage",
      dsNameList: DATASET,
      bypassPopupClose: false,
    }, opened.cookie);
    return { key, ok: true, status: next.status, before, after: summary(next.state), responseAction: next.state.action ?? null };
  } catch (error) {
    return { key, ok: false, before, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET() {
  try {
    const candidates = [`${GRID_KEY}pagination`, `${GRID_KEY}.pagination`];
    const results = [];
    for (const key of candidates) results.push(await testKey(key));
    return NextResponse.json({ ok: results.some(result => result.ok), results });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
