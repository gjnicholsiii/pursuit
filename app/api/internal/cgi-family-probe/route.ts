import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const URL = "https://vss.ky.gov/vssprod-ext/Advantage4";
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

function pageOpenPayload(state: Obj, nav: Obj) {
  return {
    action: {
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
    },
    session_info: state.session_info,
    data: state.data,
  };
}

async function pageOpen(referer: string, state: Obj, nav: Obj, cookie: string) {
  const response = await fetch(nav.applicationUrl || referer, {
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
    body: JSON.stringify(pageOpenPayload(state, nav)),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`pageOpen returned ${response.status}: ${text.slice(0, 250)}`);
  return { state: JSON.parse(text) as Obj, cookie: mergeCookies(cookie, response.headers.get("set-cookie")) };
}

function collectGridCandidates(value: unknown, path = "$", out: Array<Record<string, unknown>> = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectGridCandidates(item, `${path}[${index}]`, out));
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const object = value as Obj;
  const stringValues = Object.values(object).filter(item => typeof item === "string") as string[];
  if (stringValues.some(item => item.includes("T1SO_SRCH_QRY"))) {
    out.push({
      path,
      key: object.key ?? null,
      name: object.name ?? null,
      dataSource: object.dataSource ?? object.data_source ?? object.datasource ?? object.dsName ?? object.ds_name ?? null,
      template: object.template ?? null,
      title: object.title ?? null,
      type: object.type ?? null,
      parentKey: object.parentKey ?? null,
      properties: Object.fromEntries(Object.entries(object).filter(([key, child]) => typeof child === "string" && /key|name|source|template|title|type/i.test(key)).slice(0, 20)),
    });
  }
  for (const [key, child] of Object.entries(object)) collectGridCandidates(child, `${path}.${key}`, out);
  return out;
}

export async function GET() {
  try {
    const initialResponse = await fetch(URL, {
      headers: { accept: "text/html,*/*", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
      cache: "no-store",
    });
    if (!initialResponse.ok) throw new Error(`Kentucky VSS returned ${initialResponse.status}`);
    const initial = parseInitial(await initialResponse.text());
    let cookie = cookieHeader(initialResponse.headers.get("set-cookie"));
    const carouselAction = findByName(initial, "carousalAction");
    if (!carouselAction) throw new Error("carousalAction was not found");
    const carousel = await pageOpen(initialResponse.url, initial, carouselAction, cookie);
    cookie = carousel.cookie;
    const solicitationsAction = findByName(carousel.state, "solicitations");
    if (!solicitationsAction) throw new Error("solicitations action was not found");
    const solicitations = await pageOpen(initialResponse.url, carousel.state, solicitationsAction, cookie);
    const ds = solicitations.state.data?.ds_data?.T1SO_SRCH_QRY || {};
    return NextResponse.json({
      ok: true,
      page: {
        action: solicitations.state.action ?? null,
        sessionPageId: solicitations.state.session_info?.page_id ?? null,
        targetQualifiedName: solicitations.state.session_info?.targetQualifiedName ?? solicitationsAction.targetQualifiedName ?? null,
      },
      dataset: {
        name: ds.name ?? "T1SO_SRCH_QRY",
        rows: Array.isArray(ds.row_data) ? ds.row_data.length : 0,
        startDataWindow: ds.start_data_window ?? null,
        endDataWindow: ds.end_data_window ?? null,
        startPageWindow: ds.start_page_window ?? null,
        endPageWindow: ds.end_page_window ?? null,
        rowsPerPage: ds.rows_per_page ?? null,
        rowsTotal: ds.rows_total ?? null,
        totalCountSuffix: ds.total_count_suffix ?? null,
      },
      gridCandidates: collectGridCandidates(solicitations.state).slice(0, 30),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
