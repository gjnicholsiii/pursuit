import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const PORTALS = [
  { state: "KY", name: "Kentucky VSS", url: "https://vss.ky.gov/vssprod-ext/Advantage4" },
  { state: "ME", name: "Maine VSS", url: "https://mevss.hostams.com/PRDVSS1X1/AltSelfService" },
  { state: "MI", name: "Michigan SIGMA VSS", url: "https://sigma.michigan.gov/PRDVSS1X1/Advantage4" },
  { state: "WV", name: "West Virginia wvOASIS VSS", url: "https://prd311.wvoasis.gov/PRDVSS1X1/Advantage4" },
];

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function snippets(html: string, needles: string[]) {
  const lower = html.toLowerCase();
  return needles.flatMap(needle => {
    const index = lower.indexOf(needle.toLowerCase());
    if (index < 0) return [];
    return [{ needle, snippet: compact(html.slice(Math.max(0, index - 250), index + 750)).slice(0, 1100) }];
  });
}

async function inspectPortal(portal: (typeof PORTALS)[number]) {
  const response = await fetch(portal.url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36 PursuitGovernmentRevenue/1.0",
    },
    redirect: "follow",
    cache: "no-store",
  });
  const html = await response.text();
  const $ = load(html);
  const cookieNames = (response.headers.get("set-cookie") || "")
    .split(/,(?=[^;,]+=)/)
    .map(part => part.split(";")[0]?.split("=")[0]?.trim())
    .filter(Boolean);
  const scripts = $("script[src]").toArray().map(node => $(node).attr("src") || "").filter(Boolean).slice(0, 30);
  const forms = $("form").toArray().map(node => ({
    id: $(node).attr("id") || null,
    name: $(node).attr("name") || null,
    action: $(node).attr("action") || null,
    method: $(node).attr("method") || null,
  })).slice(0, 20);
  const text = compact($("body").text());
  const markers = [
    "View Published Solicitations",
    "T1SO_SRCH_QRY",
    "row_data",
    "ds_data",
    "Advantage4",
    "AltSelfService",
    "Public Access",
    "Guest",
    "carousel",
    "solicitation",
  ];
  return {
    state: portal.state,
    name: portal.name,
    status: response.status,
    ok: response.ok,
    finalUrl: response.url,
    contentType: response.headers.get("content-type"),
    bytes: html.length,
    cookieNames,
    scripts,
    forms,
    title: $("title").text().trim() || null,
    bodyHead: text.slice(0, 900),
    markerSnippets: snippets(html, markers),
  };
}

export async function GET() {
  const results = [];
  for (const portal of PORTALS) {
    try {
      results.push(await inspectPortal(portal));
    } catch (error) {
      results.push({
        state: portal.state,
        name: portal.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return NextResponse.json({ ok: results.every(result => result.ok), results });
}
