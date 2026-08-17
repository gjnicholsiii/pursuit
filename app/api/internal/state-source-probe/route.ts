import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SOURCES: Record<string, string[]> = {
  missouri: [
    "https://ewqg.fa.us8.oraclecloud.com/fscmRestApi/resources/11.13.18.05/supplierNegotiations?limit=5&onlyData=true",
    "https://ewqg.fa.us8.oraclecloud.com/fscmRestApi/resources/11.13.18.05/supplierNegotiations?limit=5&onlyData=true&expand=abstracts",
    "https://ewqg.fa.us8.oraclecloud.com/fscmUI/redwood/negotiation-abstracts/view/abstractlisting?prcBuId=300000005255687&ojSpLang=en",
  ],
  ohio: [
    "https://ohiobuys.ohio.gov/page.aspx/en/rfp/request_browse_public",
    "https://ohiobuys.ohio.gov/page.aspx/en/bas/browser_check",
  ],
  kentucky: [
    "https://vss.ky.gov/vssprod-ext/Advantage4",
  ],
};

function compactText(value: string, max = 1800) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function extractScriptUrls(html: string, base: string) {
  return [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)]
    .map(match => {
      try { return new URL(match[1].replace(/&amp;/g, "&"), base).toString(); } catch { return match[1]; }
    })
    .slice(-8);
}

function interesting(text: string) {
  const needles = ["/api/", "solicitation", "opportunit", "request_browse_public", "business opportunities", "negotiation", "abstract", "search", "datasource", "Advantage4"];
  const lower = text.toLowerCase();
  const results: string[] = [];
  for (const needle of needles) {
    let start = 0;
    while (results.length < 12) {
      const index = lower.indexOf(needle.toLowerCase(), start);
      if (index < 0) break;
      results.push(compactText(text.slice(Math.max(0, index - 220), index + 520), 750));
      start = index + needle.length;
    }
  }
  return [...new Set(results)].slice(0, 12);
}

async function inspect(url: string) {
  const response = await fetch(url, {
    redirect: "follow",
    cache: "no-store",
    headers: {
      accept: "application/json,text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
  });
  const body = await response.text();
  const scripts = extractScriptUrls(body, response.url);
  const scriptFindings: Array<{ url: string; status: number; findings: string[] }> = [];
  for (const script of scripts) {
    try {
      const scriptResponse = await fetch(script, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
      if (!scriptResponse.ok) continue;
      const scriptBody = await scriptResponse.text();
      const findings = interesting(scriptBody);
      if (findings.length) scriptFindings.push({ url: script, status: scriptResponse.status, findings });
    } catch {
      // Diagnostic only.
    }
  }
  return {
    requested: url,
    finalUrl: response.url,
    status: response.status,
    contentType: response.headers.get("content-type"),
    size: body.length,
    preview: compactText(body),
    findings: interesting(body),
    scripts,
    scriptFindings,
  };
}

export async function GET(request: NextRequest) {
  if (request.headers.get("host") !== "pursuit-neon.vercel.app") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const source = request.nextUrl.searchParams.get("source") || "missouri";
  const urls = SOURCES[source];
  if (!urls) return NextResponse.json({ ok: false, error: "Unknown source" }, { status: 400 });
  const results = [];
  for (const url of urls) {
    try { results.push(await inspect(url)); }
    catch (error) { results.push({ requested: url, error: error instanceof Error ? error.message : String(error) }); }
  }
  return NextResponse.json({ ok: true, source, results });
}
