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
  throw new Error("moInitialResponse JSON was not balanced");
}

function parseInitial(html: string) {
  const marker = html.search(/var\s+moInitialResponse\s*=\s*/i);
  if (marker < 0) throw new Error("moInitialResponse was not found");
  const brace = html.indexOf("{", marker);
  if (brace < 0) throw new Error("moInitialResponse JSON start was not found");
  return JSON.parse(extractJsonObject(html, brace)) as Record<string, unknown>;
}

function summarizeAction(object: Record<string, unknown>, path: string) {
  return {
    path,
    key: object.key ?? null,
    name: object.name ?? null,
    title: object.title ?? null,
    actionType: object.actionType ?? null,
    actionCode: object.actionCode ?? null,
    targetComponentType: object.targetComponentType ?? null,
    targetQualifiedName: object.targetQualifiedName ?? null,
    targetLocation: object.targetLocation ?? object.targetLocationOther ?? null,
    applicationUrl: object.applicationUrl ?? null,
    isCarouselNavigation: object.isCarouselNavigation ?? null,
    dsNameList: object.dsNameList ?? null,
    protected: object.protected ?? null,
    bypassTxnCatalog: object.bypassTxnCatalog ?? null,
    params: object.params ?? null,
  };
}

function collectNavActions(value: unknown, path = "$", out: Array<Record<string, unknown>> = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNavActions(item, `${path}[${index}]`, out));
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const object = value as Record<string, unknown>;
  const looksLikeNav = object.actionType === "navAction" ||
    (typeof object.targetQualifiedName === "string" && typeof object.applicationUrl === "string");
  if (looksLikeNav) out.push(summarizeAction(object, path));
  for (const [key, child] of Object.entries(object)) collectNavActions(child, `${path}.${key}`, out);
  return out;
}

async function inspectPortal(portal: (typeof PORTALS)[number]) {
  const response = await fetch(portal.url, {
    headers: {
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${portal.name} returned ${response.status}`);
  const initial = parseInitial(await response.text());
  const data = initial.data as Record<string, unknown> | undefined;
  const pageData = data?.page_data as Record<string, unknown> | undefined;
  const globalParams = pageData?.global_params as Record<string, unknown> | undefined;
  const session = initial.session_info as Record<string, unknown> | undefined;
  return {
    state: portal.state,
    name: portal.name,
    finalUrl: response.url,
    guest: globalParams?.GUEST_SESSION ?? null,
    initialAction: initial.action ?? null,
    sessionFields: {
      hasSessionId: Boolean(session?.session_id),
      hasPageId: Boolean(session?.page_id),
      hasCsrfToken: Boolean(session?.csrf_token),
    },
    navActions: collectNavActions(initial).slice(0, 100),
  };
}

export async function GET() {
  const results = [];
  for (const portal of PORTALS) {
    try {
      results.push(await inspectPortal(portal));
    } catch (error) {
      results.push({ state: portal.state, name: portal.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ ok: results.every(result => !("error" in result)), results });
}
