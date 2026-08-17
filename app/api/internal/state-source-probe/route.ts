import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KY_URL = "https://vss.ky.gov/vssprod-ext/Advantage4";
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

function extractInitialResponse(html: string) {
  const marker = "var moInitialResponse = ";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const after = html.slice(start + marker.length);
  const end = after.indexOf("</script>");
  if (end < 0) return null;
  const raw = after.slice(0, end).trim().replace(/;\s*$/, "");
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

function extractMissouriConfig(html: string) {
  const keys = ["APP_NAME", "APP_ID", "APP_VERSION", "BASE_URL", "vbInitConfig", "serviceConnections", "negotiation-abstracts"];
  return keys.map(key => {
    const index = html.indexOf(key);
    return index < 0 ? null : html.slice(Math.max(0, index - 300), Math.min(html.length, index + 900)).replace(/\s+/g, " ");
  }).filter(Boolean);
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
    return NextResponse.json({
      ok: true,
      source,
      status: response.status,
      guest: html.includes('"GUEST_SESSION":"true"'),
      metadataFound: Boolean(initial),
      matches: initial ? walk(initial).slice(0, 100) : [],
    });
  }
  if (source === "missouri") {
    const response = await fetch(MO_URL, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
    const html = await response.text();
    return NextResponse.json({ ok: true, source, status: response.status, config: extractMissouriConfig(html) });
  }
  return NextResponse.json({ ok: false, error: "Unknown source" }, { status: 400 });
}
