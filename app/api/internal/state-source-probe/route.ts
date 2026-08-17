import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KY_URL = "https://vss.ky.gov/vssprod-ext/Advantage4";
type Obj = Record<string, unknown>;
type CookieJar = Map<string, string>;
type Session = { session_id: string; csrf_token: string; page_id: string };

function extractBalancedJson(text: string, start: number) {
  let depth = 0, inString = false, escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

function extractInitialResponse(html: string): Obj | null {
  const marker = html.match(/var\s+moInitialResponse\s*=\s*/);
  if (!marker || marker.index === undefined) return null;
  const start = html.indexOf("{", marker.index + marker[0].length);
  if (start < 0) return null;
  const raw = extractBalancedJson(html, start);
  if (!raw) return null;
  try { return JSON.parse(raw) as Obj; } catch { return null; }
}

function collectObjects(value: unknown, out: Obj[] = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) { value.forEach(item => collectObjects(item, out)); return out; }
  const record = value as Obj;
  out.push(record);
  Object.values(record).forEach(child => collectObjects(child, out));
  return out;
}

function str(record: Obj, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function findSession(objects: Obj[]): Session | null {
  const record = objects.find(item => str(item, "session_id") && str(item, "csrf_token") && str(item, "page_id"));
  return record ? { session_id: str(record, "session_id"), csrf_token: str(record, "csrf_token"), page_id: str(record, "page_id") } : null;
}

function findAction(objects: Obj[], target: string, name?: string) {
  return objects.find(item => str(item, "targetQualifiedName") === target || (name && str(item, "name") === name)) || null;
}

function buildPayload(action: Obj, session: Session) {
  return {
    action: {
      actionType: str(action, "actionType") || "navAction",
      actionCode: str(action, "actionCode") || "navAction",
      viewName: str(action, "viewName"),
      targetPage: str(action, "targetPage"),
      targetPageId: str(action, "targetPageId"),
      targetQualifiedName: str(action, "targetQualifiedName"),
      params: {
        targetLocation: str(action, "targetLocation") || "display",
        targetComponentType: str(action, "targetComponentType"),
        targetMode: str(action, "targetMode") || "browse",
      },
    },
    key: str(action, "key"),
    session_info: session,
  };
}

function getSetCookies(headers: Headers) {
  const special = headers as Headers & { getSetCookie?: () => string[] };
  const values = special.getSetCookie?.();
  return values?.length ? values : (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
}

function rememberCookies(jar: CookieJar, headers: Headers) {
  for (const setCookie of getSetCookies(headers)) {
    const pair = setCookie.split(";", 1)[0]?.trim();
    if (!pair) continue;
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim(), value = pair.slice(separator + 1).trim();
    if (!value) jar.delete(name); else jar.set(name, value);
  }
}

function cookieHeader(jar: CookieJar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function fetchWithJar(url: string, jar: CookieJar, init: RequestInit = {}, redirects = 6): Promise<Response> {
  let currentUrl = url, method = init.method || "GET", body = init.body;
  for (let attempt = 0; attempt <= redirects; attempt += 1) {
    const headers = new Headers(init.headers || {});
    const cookies = cookieHeader(jar);
    if (cookies) headers.set("cookie", cookies);
    const response = await fetch(currentUrl, { ...init, method, body, headers, redirect: "manual", cache: "no-store" });
    rememberCookies(jar, response.headers);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    currentUrl = new URL(location, currentUrl).toString();
    if ([301, 302, 303].includes(response.status) && method !== "GET" && method !== "HEAD") { method = "GET"; body = undefined; }
  }
  throw new Error("Kentucky guest flow exceeded redirect limit");
}

async function postAction(url: string, jar: CookieJar, action: Obj, session: Session, referer: string) {
  const response = await fetchWithJar(url, jar, {
    method: "POST",
    headers: {
      accept: "application/json,text/plain,*/*",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
      "x-csrf-token": session.csrf_token,
      origin: new URL(url).origin,
      referer,
    },
    body: JSON.stringify(buildPayload(action, session)),
  });
  const text = await response.text();
  let json: Obj | null = null;
  try { json = JSON.parse(text) as Obj; } catch { /* diagnostic */ }
  return { response, text, json };
}

function findSolicitationArrays(value: unknown, path = "$", out: Array<{ path: string; rows: Obj[] }> = []) {
  if (Array.isArray(value)) {
    const rows = value.filter(item => item && typeof item === "object" && !Array.isArray(item)) as Obj[];
    if (rows.some(row => typeof row.DOC_REF === "string" && typeof row.DOC_DSCR === "string")) out.push({ path, rows });
    value.forEach((item, index) => findSolicitationArrays(item, `${path}[${index}]`, out));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Obj)) findSolicitationArrays(child, `${path}.${key}`, out);
  }
  return out;
}

function findPagingScalars(value: unknown, path = "$", out: Array<{ path: string; value: string | number | boolean }> = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) { value.forEach((item, index) => findPagingScalars(item, `${path}[${index}]`, out)); return out; }
  for (const [key, child] of Object.entries(value as Obj)) {
    const nextPath = `${path}.${key}`;
    if (["string", "number", "boolean"].includes(typeof child) && /count|rows|page|offset|limit|total|record|fetch/i.test(key)) {
      out.push({ path: nextPath, value: child as string | number | boolean });
    } else findPagingScalars(child, nextPath, out);
  }
  return out;
}

export async function GET(request: NextRequest) {
  if (request.headers.get("host") !== "pursuit-neon.vercel.app") return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const jar: CookieJar = new Map();
  const shell = await fetchWithJar(KY_URL, jar, { headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0", accept: "text/html,application/xhtml+xml" } });
  const initial = extractInitialResponse(await shell.text());
  if (!initial) return NextResponse.json({ ok: false, error: "Initial guest response not found" }, { status: 500 });
  const initialObjects = collectObjects(initial);
  const initialSession = findSession(initialObjects);
  const carouselAction = findAction(initialObjects, "vss.page.VAXXX03153");
  if (!initialSession || !carouselAction) return NextResponse.json({ ok: false, error: "Kentucky guest carousel prerequisites missing" }, { status: 500 });

  const applicationUrl = new URL(str(carouselAction, "applicationUrl"), shell.url).toString();
  const carousel = await postAction(applicationUrl, jar, carouselAction, initialSession, shell.url);
  if (!carousel.json) return NextResponse.json({ ok: false, error: "Kentucky carousel did not return JSON" }, { status: 502 });
  const carouselObjects = collectObjects(carousel.json);
  const solicitationAction = findAction(carouselObjects, "vss.page.VVSSX10019", "solicitations");
  if (!solicitationAction) return NextResponse.json({ ok: false, error: "Published solicitations action not found" }, { status: 500 });

  const solicitations = await postAction(applicationUrl, jar, solicitationAction, findSession(carouselObjects) || initialSession, applicationUrl);
  if (!solicitations.json) return NextResponse.json({ ok: false, error: "Published solicitations did not return JSON" }, { status: 502 });
  const arrays = findSolicitationArrays(solicitations.json);
  const best = arrays.sort((a, b) => b.rows.length - a.rows.length)[0];
  const sample = (best?.rows || []).slice(0, 3).map(row => ({
    DOC_REF: row.DOC_REF,
    DOC_DSCR: row.DOC_DSCR,
    DEPT_NM: row.DEPT_NM,
    DOC_CD: row.DOC_CD,
    SO_STA: row.SO_STA,
    SO_CLSNG_DT_TM: row.SO_CLSNG_DT_TM,
    PUB_DT: row.PUB_DT,
  }));

  return NextResponse.json({
    ok: true,
    cookieCount: jar.size,
    datasetPath: best?.path || null,
    rowsReturned: best?.rows.length || 0,
    arrayCandidates: arrays.map(item => ({ path: item.path, rows: item.rows.length })).slice(0, 10),
    paging: findPagingScalars(solicitations.json).slice(0, 100),
    sample,
  });
}
