import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const PORTALS = [
  { state: "KY", name: "Kentucky VSS", url: "https://vss.ky.gov/vssprod-ext/Advantage4" },
  { state: "MI", name: "Michigan SIGMA VSS", url: "https://sigma.michigan.gov/PRDVSS1X1/Advantage4" },
];

type JsonObject = Record<string, any>;

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

function parseInitial(html: string): JsonObject {
  const marker = html.search(/var\s+moInitialResponse\s*=\s*/i);
  if (marker < 0) throw new Error("moInitialResponse was not found");
  const brace = html.indexOf("{", marker);
  if (brace < 0) throw new Error("moInitialResponse JSON start was not found");
  return JSON.parse(extractJsonObject(html, brace));
}

function cookies(setCookie: string | null) {
  if (!setCookie) return "";
  return setCookie.split(/,(?=[^;,]+=)/).map(part => part.split(";")[0].trim()).filter(Boolean).join("; ");
}

function mergeCookies(left: string, setCookie: string | null) {
  const values = new Map<string, string>();
  for (const header of [left, cookies(setCookie)]) {
    for (const item of header.split(";").map(value => value.trim()).filter(Boolean)) {
      const split = item.indexOf("=");
      if (split > 0) values.set(item.slice(0, split), item.slice(split + 1));
    }
  }
  return [...values.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function findByName(value: unknown, name: string): JsonObject | null {
  if (Array.isArray(value)) {
    for (const item of value) { const found = findByName(item, name); if (found) return found; }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const object = value as JsonObject;
  if (object.name === name) return object;
  for (const child of Object.values(object)) { const found = findByName(child, name); if (found) return found; }
  return null;
}

function pageOpenPayload(state: JsonObject, nav: JsonObject) {
  const session = JSON.parse(JSON.stringify(state.session_info || {}));
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
    session_info: session,
    data: state.data,
  };
}

async function pageOpen(baseUrl: string, referer: string, state: JsonObject, nav: JsonObject, cookie: string) {
  const csrf = state.session_info?.csrf_token;
  const response = await fetch(nav.applicationUrl || baseUrl, {
    method: "POST",
    headers: {
      accept: "application/json,text/plain,*/*",
      "content-type": "application/json;charset=UTF-8",
      referer,
      origin: new URL(referer).origin,
      ...(csrf ? { "x-csrf-token": String(csrf) } : {}),
      ...(cookie ? { cookie } : {}),
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    body: JSON.stringify(pageOpenPayload(state, nav)),
    redirect: "follow",
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`pageOpen ${nav.name || nav.targetQualifiedName} returned ${response.status}: ${text.slice(0, 300)}`);
  let json: JsonObject;
  try { json = JSON.parse(text); } catch { throw new Error(`pageOpen returned non-JSON: ${text.slice(0, 300)}`); }
  return { json, cookie: mergeCookies(cookie, response.headers.get("set-cookie")), status: response.status };
}

function datasetSummary(state: JsonObject) {
  const datasets = state.data?.ds_data || {};
  return Object.fromEntries(Object.entries(datasets).map(([name, value]) => {
    const dataset = value as JsonObject;
    const rows = Array.isArray(dataset.row_data) ? dataset.row_data : [];
    return [name, {
      rows: rows.length,
      rowsSent: dataset.rows_sent ?? dataset.rowsSent ?? null,
      rowsTotal: dataset.rows_total ?? dataset.rowsTotal ?? dataset.total_count ?? null,
      rowsPerPage: dataset.rows_per_page ?? dataset.rowsPerPage ?? null,
      totalCountSuffix: dataset.total_count_suffix ?? null,
      firstRows: rows.slice(0, 3),
      keys: Object.keys(dataset).filter(key => key !== "row_data").slice(0, 40),
    }];
  }));
}

async function inspect(portal: (typeof PORTALS)[number]) {
  const initialResponse = await fetch(portal.url, {
    headers: { accept: "text/html,*/*", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    redirect: "follow",
    cache: "no-store",
  });
  if (!initialResponse.ok) throw new Error(`${portal.name} returned ${initialResponse.status}`);
  const initial = parseInitial(await initialResponse.text());
  let cookie = cookies(initialResponse.headers.get("set-cookie"));

  const carouselAction = findByName(initial, "carousalAction");
  if (!carouselAction) throw new Error("carousalAction was not found");
  const carousel = await pageOpen(portal.url, initialResponse.url, initial, carouselAction, cookie);
  cookie = carousel.cookie;

  const solicitationsAction = findByName(carousel.json, "solicitations");
  if (!solicitationsAction) throw new Error("solicitations action was not found");
  const solicitations = await pageOpen(portal.url, initialResponse.url, carousel.json, solicitationsAction, cookie);

  const datasets = datasetSummary(solicitations.json);
  return {
    state: portal.state,
    carouselStatus: carousel.status,
    solicitationsStatus: solicitations.status,
    action: {
      key: solicitationsAction.key,
      targetQualifiedName: solicitationsAction.targetQualifiedName,
      targetComponentType: solicitationsAction.targetComponentType,
    },
    pageAction: solicitations.json.action ?? null,
    datasets,
    hasTargetDataset: Boolean((solicitations.json.data?.ds_data || {}).T1SO_SRCH_QRY),
  };
}

export async function GET() {
  const results = [];
  for (const portal of PORTALS) {
    try { results.push(await inspect(portal)); }
    catch (error) { results.push({ state: portal.state, error: error instanceof Error ? error.message : String(error) }); }
  }
  return NextResponse.json({ ok: results.every(result => !("error" in result)), results });
}
