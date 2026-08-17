import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KY_URL = "https://vss.ky.gov/vssprod-ext/Advantage4";

function resolveScripts(html: string, pageUrl: string) {
  const baseMatch = html.match(/<base\s+href=["']([^"']+)["']/i);
  const base = baseMatch?.[1] || pageUrl;
  return [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(match => {
    try { return new URL(match[1], base).toString(); } catch { return match[1]; }
  });
}

function occurrences(text: string, term: string, limit = 12) {
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const found: string[] = [];
  let from = 0;
  while (found.length < limit) {
    const index = lower.indexOf(needle, from);
    if (index < 0) break;
    found.push(text.slice(Math.max(0, index - 1300), Math.min(text.length, index + needle.length + 2300)).replace(/\s+/g, " "));
    from = index + needle.length;
  }
  return found;
}

export async function GET(request: NextRequest) {
  if (request.headers.get("host") !== "pursuit-neon.vercel.app") return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const shell = await fetch(KY_URL, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
  const html = await shell.text();
  const scripts = resolveScripts(html, shell.url);
  const appUrl = scripts.find(url => /\/advjs\/app\./i.test(url));
  if (!appUrl) return NextResponse.json({ ok: false, error: "Kentucky app bundle not found" }, { status: 500 });
  const app = await fetch(appUrl, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
  const body = await app.text();
  return NextResponse.json({
    ok: true,
    appUrl,
    startCallers: occurrences(body, "getStartDataWindow()"),
    endCallers: occurrences(body, "getEndDataWindow()"),
  });
}
