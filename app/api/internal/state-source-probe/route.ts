import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KY_URL = "https://vss.ky.gov/vssprod-ext/Advantage4";

type Obj = Record<string, unknown>;

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
  const result: Obj = {
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
  return result;
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

  const shell = await fetch(KY_URL, {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
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
  const cookie = shell.headers.get("set-cookie") || "";
  const payload = buildPayload(action, session);
  const response = await fetch(applicationUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      accept: "application/json,text/plain,*/*",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body = await response.text();

  return NextResponse.json({
    ok: true,
    action: compactAction(action),
    applicationUrl,
    postStatus: response.status,
    postContentType: response.headers.get("content-type"),
    responseSize: body.length,
    responsePreview: body.slice(0, 1200),
    findings: summarizeResponse(body),
  });
}
