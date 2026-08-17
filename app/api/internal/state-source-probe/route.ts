import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KY_URL = "https://vss.ky.gov/vssprod-ext/Advantage4";

function snippets(text: string, terms: string[], max = 50) {
  const lower = text.toLowerCase();
  const result: string[] = [];
  for (const term of terms) {
    let from = 0;
    while (result.length < max) {
      const index = lower.indexOf(term.toLowerCase(), from);
      if (index < 0) break;
      result.push(text.slice(Math.max(0, index - 900), Math.min(text.length, index + 1800)).replace(/\s+/g, " "));
      from = index + term.length;
    }
  }
  return [...new Set(result)].slice(0, max);
}

function resolveAppScript(html: string, pageUrl: string) {
  const baseMatch = html.match(/<base\s+href=["']([^"']+)["']/i);
  const base = baseMatch?.[1] || pageUrl;
  const srcs = [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(match => match[1]);
  const app = srcs.find(src => /advjs\/app\./i.test(src));
  if (!app) return null;
  try { return new URL(app, base).toString(); } catch { return app; }
}

export async function GET(request: NextRequest) {
  if (request.headers.get("host") !== "pursuit-neon.vercel.app") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const shell = await fetch(KY_URL, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
  const html = await shell.text();
  const appUrl = resolveAppScript(html, shell.url);
  if (!appUrl) return NextResponse.json({ ok: false, error: "Kentucky app bundle not found" }, { status: 500 });
  const app = await fetch(appUrl, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
  const body = await app.text();

  return NextResponse.json({
    ok: true,
    appUrl,
    size: body.length,
    findings: snippets(body, [
      "csrf_token",
      "metadata_version",
      "data_version",
      "checksum",
      "session_id",
      "setLatestPageId",
      "applicationUrl:e",
      "applicationUrl",
      "targetQualifiedName",
      "HttpClient",
      "http.post",
      ".post(",
      "headers:new",
      "Content-Type",
      "X-CSRF",
      "pageOpen",
      "navActionKey",
      "page_data",
    ], 45),
  });
}
