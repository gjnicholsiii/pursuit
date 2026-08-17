import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KY_URL = "https://vss.ky.gov/vssprod-ext/Advantage4";

type Obj = Record<string, unknown>;
type CookieJar = Map<string, string>;

function extractBalancedJson(text: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;
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
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
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
  if (Array.isArray(value)) {
    value.forEach(item => collectObjects(item, out));
    return out;
  }
  const record = value as Obj;
  out.push(record);
  Object.values(record).forEach(child => collectObjects(child, out));
  return out;
}

function str(record: Obj, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function findSession(objects: Obj[]) {
  const record = objects.find(item => str(item, "session_id") && str(item, "csrf_token") && str(item, "page_id"));
  return record ? {
    session_id: str(record, "session_id"),
    csrf_token: str(record, "csrf_token"),
    page_id: str(record, "page_id"),
  } : null;
}

function findAction(objects: Obj[]) {
  return objects.find(item =>
    str(item, "targetQualifiedName") === "vss.page.VAXXX03153" ||
    /what would you like to do/i.test(str(item, "title"))
  ) || null;
}

function findApplicationUrl(objects: Obj[], action: Obj | null) {
  const direct = action ? str(action, "applicationUrl") : "";
  if (direct) return direct;
  const match = objects.find(item => /^https?:\/\//i.test(str(item, "applicationUrl")) || str(item, "applicationUrl").startsWith("/"));
  return match ? str(match, "applicationUrl") : "";
}

function compactAction(action: Obj | null) {
  if (!action) return null;
  const allowed = ["key", "name", "title", "actionType", "actionCode", "viewName", "targetLocation", "targetComponentType", "targetPage", "targetPageId", "targetQualifiedName", "applicationUrl", "columnName", "columnValue"];
  return Object.fromEntries(allowed.flatMap(key => action[key] !== undefined ? [[key, action[key]]] : []));
}

function buildPayload(action: Obj, session: { session_id: string; csrf_token: string; page_id: string }) {
  const targetLocation = str(action, "targetLocation") || "display";
  const targetComponentType = str(action, "targetComponentType");
  return {
    action: {
      actionType: str(action, "actionType") || "navAction",
      actionCode: str(action, "actionCode"),
      viewName: str(action, "viewName"),
      targetPage: str(action, "targetPage"),
      targetPageId: str(action, "targetPageId"),
      targetQualifiedName: str(action, "targetQualifiedName"),
      params: { targetLocation, targetComponentType },
    },
    key: str(action, "key"),
    session_info: session,
  };
}

function getSetCookies(headers: Headers) {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const values = withGetSetCookie.getSetCookie?.();
  if (values?.length) return values;
  const fallback = headers.get("set-cookie");
  return fallback ? [fallback] : [];
}

function rememberCookies(jar: CookieJar, headers: Headers) {
  for (const setCookie of getSetCookies(headers)) {
    const pair = setCookie.split(";", 1)[0]?.trim();
    if (!pair) continue;
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!name) continue;
    if (!value) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader(jar: CookieJar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function fetchWithJar(url: string, jar: CookieJar, init: RequestInit = {}, redirects = 6): Promise<Response> {
  let currentUrl = url;
  let method = init.method || "GET";
  let body = init.body;
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
    if ([301, 302, 303].includes(response.status) && method !== "GET" && method !== "HEAD") {
      method = "GET";
      body = undefined;
    }
  }
  throw new Error("Kentucky guest flow exceeded redirect limit");
}

function summarizeResponse(body: string) {
  const terms = ["Business Opportunities", "Solicitation", "Bid", "VAPUB", "VSS", "commodity", "closing", "response date", "document"];
  const lower = body.toLowerCase();
  const snippets: string[] = [];
  for (const term of terms) {
    let from = 0;
    while (snippets.length < 25) {
      const index = lower.indexOf(term.toLowerCase(), from);
      if (index < 0) break;
      snippets.push(body.slice(Math.max(0, index - 350), Math.min(body.length, index + 900)).replace(/\s+/g, " "));
      from = index + term.length;
    }
  }
  return [...new Set(snippets)].slice(0, 25);
}

export async function GET(request: NextRequest) {
  if (request.headers.get("host") !== "pursuit-neon.vercel.app") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const jar: CookieJar = new Map();
  const shell = await fetchWithJar(KY_URL, jar, {
    headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0", accept: "text/html,application/xhtml+xml" },
  });
  const html = await shell.text();
  const initial = extractInitialResponse(html);
  if (!initial) return NextResponse.json({ ok: false, error: "Initial guest response not found" }, { status: 500 });
  const objects = collectObjects(initial);
  const session = findSession(objects);
  const action = findAction(objects);
  const applicationUrlRaw = findApplicationUrl(objects, action);
  if (!session || !action || !applicationUrlRaw) {
    return NextResponse.json({ ok: false, error: "Guest navigation prerequisites missing", hasSession: Boolean(session), action: compactAction(action), applicationUrlRaw });
  }

  const applicationUrl = new URL(applicationUrlRaw, shell.url).toString();
  const payload = buildPayload(action, session);
  const response = await fetchWithJar(applicationUrl, jar, {
    method: "POST",
    headers: {
      accept: "application/json,text/plain,*/*",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
      "x-csrf-token": session.csrf_token,
      origin: new URL(applicationUrl).origin,
      referer: shell.url,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.text();

  return NextResponse.json({
    ok: true,
    action: compactAction(action),
    applicationUrl,
    cookieCount: jar.size,
    postStatus: response.status,
    postContentType: response.headers.get("content-type"),
    responseSize: body.length,
    sessionInvalid: /SessionInvalidPage|Session Invalid/i.test(body),
    responsePreview: body.slice(0, 1200),
    findings: summarizeResponse(body),
  });
}
