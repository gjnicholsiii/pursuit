import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KY_URL = "https://vss.ky.gov/vssprod-ext/Advantage4";
const MO_URL = "https://ewqg.fa.us8.oraclecloud.com/fscmUI/redwood/negotiation-abstracts/view/abstractlisting?prcBuId=300000005255687&ojSpLang=en";

function snippets(text: string, terms: string[], max = 40) {
  const lower = text.toLowerCase();
  const result: string[] = [];
  for (const term of terms) {
    let from = 0;
    while (result.length < max) {
      const index = lower.indexOf(term.toLowerCase(), from);
      if (index < 0) break;
      result.push(text.slice(Math.max(0, index - 500), Math.min(text.length, index + 1200)).replace(/\s+/g, " "));
      from = index + term.length;
    }
  }
  return [...new Set(result)].slice(0, max);
}

function resolveScripts(html: string, pageUrl: string) {
  const baseMatch = html.match(/<base\s+href=["']([^"']+)["']/i);
  const base = baseMatch?.[1] || pageUrl;
  const scripts = [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)]
    .map(match => {
      try { return new URL(match[1], base).toString(); } catch { return match[1]; }
    });
  return { base, scripts };
}

async function inspectKentuckyApp() {
  const shellResponse = await fetch(KY_URL, {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
  });
  const html = await shellResponse.text();
  const { base, scripts } = resolveScripts(html, shellResponse.url);
  const targets = scripts.filter(url => /\/advjs\//i.test(url));
  const findings: Array<{ url: string; status: number; size: number; snippets: string[] }> = [];
  for (const url of targets) {
    try {
      const response = await fetch(url, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
      if (!response.ok) {
        findings.push({ url, status: response.status, size: 0, snippets: [] });
        continue;
      }
      const body = await response.text();
      const found = snippets(body, [
        "targetQualifiedName",
        "navAction",
        "pageChange",
        "moInitialResponse",
        "XMLHttpRequest",
        "fetch(",
        "axios",
        "$.ajax",
        "Content-Type",
        "application/json",
        "POST",
        "Advantage4",
        "actionType",
        "currentView",
        "acceptData",
      ], 25);
      if (found.length) findings.push({ url, status: response.status, size: body.length, snippets: found });
    } catch (error) {
      findings.push({ url, status: 0, size: 0, snippets: [error instanceof Error ? error.message : String(error)] });
    }
  }
  return { shellStatus: shellResponse.status, base, scripts, findings };
}

function extractMissouriConfig(html: string) {
  return snippets(html, ["APP_NAME", "APP_ID", "APP_VERSION", "serviceConnections", "negotiation-abstracts"], 30);
}

export async function GET(request: NextRequest) {
  if (request.headers.get("host") !== "pursuit-neon.vercel.app") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const source = request.nextUrl.searchParams.get("source") || "kentucky-app";
  if (source === "kentucky-app") {
    return NextResponse.json({ ok: true, source, ...(await inspectKentuckyApp()) });
  }
  if (source === "missouri") {
    const response = await fetch(MO_URL, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
    const html = await response.text();
    return NextResponse.json({ ok: true, source, status: response.status, config: extractMissouriConfig(html) });
  }
  return NextResponse.json({ ok: false, error: "Unknown source" }, { status: 400 });
}
