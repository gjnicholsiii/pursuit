import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCES = [
  "https://oeds.education.ohio.gov/DataExtract",
  "https://oedsqa.education.ohio.gov/DataExtract",
];

type Discovery = {
  source: string;
  status: number;
  bytes: number;
  formActions: string[];
  candidateEndpoints: string[];
  inputNames: string[];
  generateControls: string[];
  scriptHints: string[];
  hasPublicDistrict: boolean;
  hasPersonFields: boolean;
  hasPublicEmail: boolean;
};

function clean(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function absolute(base: string, value: string) {
  try {
    return new URL(value, base).toString();
  } catch {
    return "";
  }
}

function discover(source: string, html: string, status: number): Discovery {
  const $ = cheerio.load(html);
  const formActions = new Set<string>();
  const candidateEndpoints = new Set<string>();
  const inputNames = new Set<string>();
  const generateControls = new Set<string>();
  const scriptHints = new Set<string>();

  $("form").each((_, el) => {
    const raw = clean($(el).attr("action"));
    if (raw) {
      const url = absolute(source, raw);
      if (url) formActions.add(url);
    }
  });

  $("input[name],select[name],button[name],textarea[name]").each((_, el) => {
    const name = clean($(el).attr("name"));
    if (name) inputNames.add(name);
  });

  $("button,input[type=button],input[type=submit],a").each((_, el) => {
    const text = clean($(el).text() || $(el).attr("value"));
    if (!/generate\s*report|report|extract/i.test(text)) return;
    const detail = [
      $(el).get(0)?.tagName || "control",
      `text=${text}`,
      `id=${clean($(el).attr("id"))}`,
      `name=${clean($(el).attr("name"))}`,
      `value=${clean($(el).attr("value"))}`,
      `href=${clean($(el).attr("href"))}`,
      `onclick=${clean($(el).attr("onclick"))}`,
      `data-url=${clean($(el).attr("data-url"))}`,
    ].join("|");
    generateControls.add(detail.slice(0, 1200));
  });

  $("a[href],script[src]").each((_, el) => {
    const raw = clean($(el).attr("href") || $(el).attr("src"));
    if (!raw) return;
    const url = absolute(source, raw);
    if (url && /(extract|report|export|download|data)/i.test(url)) candidateEndpoints.add(url);
  });

  $("script").each((_, el) => {
    const text = clean($(el).html());
    if (!text || !/(generate\s*report|dataextract|report|export|download|ajax|fetch\()/i.test(text)) return;
    const matches = text.match(/.{0,180}(?:generate\s*report|dataextract|report|export|download|ajax|fetch\().{0,420}/gi) || [];
    for (const match of matches) scriptHints.add(clean(match).slice(0, 700));
  });

  const decoded = html
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\\//g, "/");
  const urlish = decoded.match(/(?:https?:\\?\/\\?\/[^"'<>\s]+|\/[A-Za-z0-9_./?=&%-]{4,})/g) || [];
  for (const raw of urlish) {
    const normalized = raw.replace(/\\\//g, "/");
    if (!/(extract|report|export|download|data)/i.test(normalized)) continue;
    const url = absolute(source, normalized);
    if (url) candidateEndpoints.add(url);
  }

  const body = clean($("body").text());
  return {
    source,
    status,
    bytes: html.length,
    formActions: [...formActions].slice(0, 20),
    candidateEndpoints: [...candidateEndpoints].slice(0, 60),
    inputNames: [...inputNames].slice(0, 250),
    generateControls: [...generateControls].slice(0, 30),
    scriptHints: [...scriptHints].slice(0, 40),
    hasPublicDistrict: /Public District/i.test(body),
    hasPersonFields: /First Name/i.test(body) && /Last Name/i.test(body) && /Title/i.test(body),
    hasPublicEmail: /Email\s*\(Primary\/Public\)/i.test(body),
  };
}

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;

  const diagnostics: Discovery[] = [];
  for (const source of SOURCES) {
    try {
      const res = await fetch(source, {
        cache: "no-store",
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; Pursuit-Raven/9.0; authoritative-public-directory)",
          accept: "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5",
        },
      });
      const html = await res.text();
      diagnostics.push(discover(res.url || source, html, res.status));
    } catch (error) {
      diagnostics.push({
        source,
        status: 0,
        bytes: 0,
        formActions: [],
        candidateEndpoints: [],
        inputNames: [],
        generateControls: [],
        scriptHints: [],
        hasPublicDistrict: false,
        hasPersonFields: false,
        hasPublicEmail: false,
      });
      console.error("RAVEN_OH_OEDS_DISCOVERY_FETCH", source, error instanceof Error ? error.message : String(error));
    }
  }

  const usable = diagnostics.find(
    d => d.status >= 200 && d.status < 400 && d.hasPublicDistrict && d.hasPersonFields && d.hasPublicEmail,
  );

  const body = usable
    ? {
        ok: false,
        state: "OH",
        source: usable.source,
        mode: "oeds-report-contract-discovery",
        blocker:
          "OEDS is reachable and exposes the required public district/person/public-email fields. This worker now emits form input names, Generate Report control attributes, candidate endpoints, and relevant script snippets so the generated-report request contract can be wired without guessing. Database writes remain fail-closed until that contract is validated.",
        diagnostics,
      }
    : {
        ok: false,
        state: "OH",
        mode: "oeds-report-contract-discovery",
        blocker: "No reachable OEDS DataExtract surface passed the public district/person/public-email confidence checks; no database writes performed.",
        diagnostics,
      };

  console.error("RAVEN_OH_AUTHORITATIVE_DISCOVERY", body);
  return NextResponse.json(body, { status: 502 });
}
