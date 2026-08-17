import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PORTALS = [
  { state: "KY", name: "Kentucky VSS", url: "https://vss.ky.gov/vssprod-ext/Advantage4" },
  { state: "MI", name: "Michigan SIGMA VSS", url: "https://sigma.michigan.gov/PRDVSS1X1/Advantage4" },
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
    if (char === '"') { inString = true; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error("JSON object was not balanced");
}

function parseInitial(html: string) {
  const marker = html.search(/var\s+moInitialResponse\s*=\s*/i);
  if (marker < 0) throw new Error("moInitialResponse was not found");
  const brace = html.indexOf("{", marker);
  if (brace < 0) throw new Error("moInitialResponse JSON start was not found");
  return JSON.parse(extractJsonObject(html, brace)) as Record<string, any>;
}

function cookieHeader(setCookie: string | null) {
  if (!setCookie) return "";
  return setCookie.split(/,(?=[^;,]+=)/).map(part => part.split(";")[0].trim()).filter(Boolean).join("; ");
}

function findByName(value: unknown, name: string): Record<string, any> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findByName(item, name);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, any>;
  if (object.name === name) return object;
  for (const child of Object.values(object)) {
    const found = findByName(child, name);
    if (found) return found;
  }
  return null;
}

function collectMatches(value: unknown, path = "$", out: Array<Record<string, unknown>> = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectMatches(item, `${path}[${index}]`, out));
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const object = value as Record<string, unknown>;
  const searchable = Object.entries(object)
    .filter(([, child]) => typeof child === "string")
    .map(([key, child]) => `${key}:${child}`)
    .join(" ");
  if (/solicit|published|opportun|bid/i.test(searchable)) {
    out.push({
      path,
      key: object.key ?? null,
      name: object.name ?? null,
      title: object.title ?? null,
      label: object.label ?? null,
      description: object.description ?? null,
      actionType: object.actionType ?? null,
      targetQualifiedName: object.targetQualifiedName ?? null,
      targetComponentType: object.targetComponentType ?? null,
      targetLocation: object.targetLocation ?? null,
      applicationUrl: object.applicationUrl ?? null,
      isCarouselNavigation: object.isCarouselNavigation ?? null,
    });
  }
  for (const [key, child] of Object.entries(object)) collectMatches(child, `${path}.${key}`, out);
  return out;
}

async function inspect(portal: (typeof PORTALS)[number]) {
  const initialResponse = await fetch(portal.url, {
    headers: { accept: "text/html,*/*", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    redirect: "follow",
    cache: "no-store",
  });
  if (!initialResponse.ok) throw new Error(`${portal.name} returned ${initialResponse.status}`);
  const initial = parseInitial(await initialResponse.text());
  const nav = findByName(initial, "carousalAction");
  if (!nav) throw new Error("carousalAction was not found");
  const session = JSON.parse(JSON.stringify(initial.session_info || {}));
  const pageId = session.page_id;
  const csrf = session.csrf_token;
  const payload = {
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
      suppressLeafing: Boolean(nav.suppressLeafing),
    },
    session_info: { ...session, page_id: pageId },
    data: initial.data,
  };
  const response = await fetch(nav.applicationUrl || initialResponse.url, {
    method: "POST",
    headers: {
      accept: "application/json,text/plain,*/*",
      "content-type": "application/json;charset=UTF-8",
      referer: initialResponse.url,
      origin: new URL(initialResponse.url).origin,
      ...(csrf ? { "x-csrf-token": String(csrf) } : {}),
      ...(initialResponse.headers.get("set-cookie") ? { cookie: cookieHeader(initialResponse.headers.get("set-cookie")) } : {}),
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    body: JSON.stringify(payload),
    redirect: "follow",
    cache: "no-store",
  });
  const body = await response.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(body) as Record<string, unknown>; } catch {}
  return {
    state: portal.state,
    status: response.status,
    contentType: response.headers.get("content-type"),
    bytes: body.length,
    jsonKeys: json ? Object.keys(json) : [],
    sessionReturned: Boolean((json as Record<string, any> | null)?.session_info),
    matches: json ? collectMatches(json).slice(0, 50) : [],
    bodyHead: json ? null : body.slice(0, 1200),
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
