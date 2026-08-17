import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KY_URL = "https://vss.ky.gov/vssprod-ext/Advantage4";
const KY_SERVICE = "https://vss.ky.gov/vssprod-ext/sofia/sofiaService.js";
const MO_URL = "https://ewqg.fa.us8.oraclecloud.com/fscmUI/redwood/negotiation-abstracts/view/abstractlisting?prcBuId=300000005255687&ojSpLang=en";

function walk(value: unknown, path = "$", out: Array<{ path: string; value: Record<string, unknown> }> = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, out));
    return out;
  }
  const record = value as Record<string, unknown>;
  const haystack = [record.name, record.title, record.targetQualifiedName, record.targetComponentType]
    .filter(v => typeof v === "string")
    .join(" ")
    .toLowerCase();
  if (/business|opportun|bid|solicit|procure|vendor/.test(haystack)) {
    out.push({
      path,
      value: Object.fromEntries(Object.entries(record).filter(([key]) => [
        "key", "name", "title", "type", "actionType", "applicationUrl", "targetComponentType",
        "targetQualifiedName", "targetLocation", "protected", "viewName", "dsNameList",
      ].includes(key))),
    });
  }
  for (const [key, child] of Object.entries(record)) walk(child, `${path}.${key}`, out);
  return out;
}

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

function extractInitialResponse(html: string) {
  const marker = html.match(/var\s+moInitialResponse\s*=\s*/);
  if (!marker || marker.index === undefined) return { value: null, error: "marker not found" };
  const start = marker.index + marker[0].length;
  const objectStart = html.indexOf("{", start);
  if (objectStart < 0) return { value: null, error: "object start not found" };
  const raw = extractBalancedJson(html, objectStart);
  if (!raw) return { value: null, error: "object end not found" };
  try { return { value: JSON.parse(raw) as Record<string, unknown>, error: null }; }
  catch (error) { return { value: null, error: error instanceof Error ? error.message : String(error) }; }
}

function snippets(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  const result: string[] = [];
  for (const term of terms) {
    let from = 0;
    while (result.length < 30) {
      const index = lower.indexOf(term.toLowerCase(), from);
      if (index < 0) break;
      result.push(text.slice(Math.max(0, index - 450), Math.min(text.length, index + 1000)).replace(/\s+/g, " "));
      from = index + term.length;
    }
  }
  return [...new Set(result)].slice(0, 30);
}

function extractMissouriConfig(html: string) {
  return snippets(html, ["APP_NAME", "APP_ID", "APP_VERSION", "serviceConnections", "negotiation-abstracts"]);
}

export async function GET(request: NextRequest) {
  if (request.headers.get("host") !== "pursuit-neon.vercel.app") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const source = request.nextUrl.searchParams.get("source") || "kentucky";
  if (source === "kentucky") {
    const response = await fetch(KY_URL, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
    const html = await response.text();
    const initial = extractInitialResponse(html);
    const allNav: Array<{ path: string; value: Record<string, unknown> }> = [];
    if (initial.value) {
      const collect = (value: unknown, path = "$") => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) return value.forEach((item, index) => collect(item, `${path}[${index}]`));
        const record = value as Record<string, unknown>;
        if (record.actionType === "navAction") {
          allNav.push({ path, value: Object.fromEntries(Object.entries(record).filter(([key]) => ["name", "title", "actionType", "applicationUrl", "targetComponentType", "targetQualifiedName", "targetLocation", "protected"].includes(key))) });
        }
        Object.entries(record).forEach(([key, child]) => collect(child, `${path}.${key}`));
      };
      collect(initial.value);
    }
    return NextResponse.json({ ok: true, source, status: response.status, guest: html.includes('"GUEST_SESSION":"true"'), allNav: allNav.slice(0, 50), matches: initial.value ? walk(initial.value).slice(0, 100) : [] });
  }
  if (source === "kentucky-service") {
    const response = await fetch(KY_SERVICE, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
    const body = await response.text();
    return NextResponse.json({ ok: true, source, status: response.status, size: body.length, findings: snippets(body, ["XMLHttpRequest", "fetch(", "$.ajax", "POST", "service", "action", "Advantage4", "sofia"]) });
  }
  if (source === "missouri") {
    const response = await fetch(MO_URL, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
    const html = await response.text();
    return NextResponse.json({ ok: true, source, status: response.status, config: extractMissouriConfig(html) });
  }
  return NextResponse.json({ ok: false, error: "Unknown source" }, { status: 400 });
}
