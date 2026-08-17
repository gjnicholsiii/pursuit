import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const PORTALS = [
  { state: "KY", name: "Kentucky VSS", url: "https://vss.ky.gov/vssprod-ext/Advantage4" },
  { state: "MI", name: "Michigan SIGMA VSS", url: "https://sigma.michigan.gov/PRDVSS1X1/Advantage4" },
];

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function snippets(source: string, needles: string[], radius = 900) {
  const lower = source.toLowerCase();
  return needles.flatMap(needle => {
    const hits = [];
    let from = 0;
    while (hits.length < 3) {
      const index = lower.indexOf(needle.toLowerCase(), from);
      if (index < 0) break;
      hits.push({ needle, snippet: compact(source.slice(Math.max(0, index - radius), index + radius)).slice(0, radius * 2) });
      from = index + needle.length;
    }
    return hits;
  });
}

async function inspectPortal(portal: (typeof PORTALS)[number]) {
  const response = await fetch(portal.url, {
    headers: {
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36 PursuitGovernmentRevenue/1.0",
    },
    redirect: "follow",
    cache: "no-store",
  });
  const html = await response.text();
  const $ = load(html);
  const baseHref = $("base").attr("href") || response.url;
  const scriptSrcs = $("script[src]").toArray().map(node => $(node).attr("src") || "").filter(Boolean);
  const interestingScripts = scriptSrcs.filter(src => /sofiaService\.js|advjs\/app\./i.test(src));
  const scriptResults = [];
  for (const src of interestingScripts) {
    const url = new URL(src, baseHref).toString();
    const scriptResponse = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
      cache: "no-store",
    });
    const source = await scriptResponse.text();
    scriptResults.push({
      url,
      status: scriptResponse.status,
      bytes: source.length,
      snippets: snippets(source, [
        "$http.post",
        ".post(",
        "csrf_token",
        "page_id",
        "session_id",
        "AcceptData",
        "acceptData",
        "actionName",
        "targetQualifiedName",
        "executeAction",
        "navigate",
        "requestData",
        "serviceUrl",
        "Advantage4",
        "sofiaService",
      ]),
    });
  }
  const initial = html.match(/var\s+moInitialResponse\s*=\s*([\s\S]*?);\s*(?:\/\/|<\/script>)/i)?.[1] || "";
  return {
    state: portal.state,
    name: portal.name,
    status: response.status,
    finalUrl: response.url,
    baseHref,
    initialBytes: initial.length,
    initialSnippets: snippets(initial, ["session_info", "csrf_token", "page_id", "isCarouselNavigation", "targetQualifiedName", "next_directives", "action"], 600),
    scripts: scriptResults,
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
