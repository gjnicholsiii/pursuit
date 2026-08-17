import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PORTALS = [
  { state: "KY", name: "Kentucky VSS", url: "https://vss.ky.gov/vssprod-ext/Advantage4" },
  { state: "MI", name: "Michigan SIGMA VSS", url: "https://sigma.michigan.gov/PRDVSS1X1/Advantage4" },
];

function parseInitial(html: string) {
  const raw = html.match(/var\s+moInitialResponse\s*=\s*([\s\S]*?);\s*(?:\/\/|<\/script>)/i)?.[1];
  if (!raw) throw new Error("moInitialResponse was not found");
  return JSON.parse(raw) as Record<string, unknown>;
}

function collectActions(value: unknown, path = "$", out: Array<Record<string, unknown>> = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectActions(item, `${path}[${index}]`, out));
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const object = value as Record<string, unknown>;
  const searchable = [
    object.title,
    object.name,
    object.key,
    object.actionType,
    object.actionCode,
    object.targetComponentType,
    object.targetQualifiedName,
  ].filter(item => typeof item === "string").join(" ");
  if (/solicit|bid|opportun|published|procure|contract/i.test(searchable)) {
    out.push({
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
      params: object.params ?? null,
    });
  }
  for (const [key, child] of Object.entries(object)) collectActions(child, `${path}.${key}`, out);
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
  const html = await response.text();
  const initial = parseInitial(html);
  const data = initial.data as Record<string, unknown> | undefined;
  const pageData = data?.page_data as Record<string, unknown> | undefined;
  const globalParams = pageData?.global_params as Record<string, unknown> | undefined;
  const session = initial.session_info as Record<string, unknown> | undefined;
  const actions = collectActions(initial);
  return {
    state: portal.state,
    name: portal.name,
    finalUrl: response.url,
    guest: globalParams?.GUEST_SESSION ?? null,
    sessionFields: {
      hasSessionId: Boolean(session?.session_id),
      hasPageId: Boolean(session?.page_id),
      hasCsrfToken: Boolean(session?.csrf_token),
    },
    procurementActions: actions,
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
