import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCES = [
  "https://oeds.education.ohio.gov/DataExtract",
  "https://oedsqa.education.ohio.gov/DataExtract",
];

type ScriptDiagnostic = {
  url: string;
  status: number;
  bytes: number;
  requestEndpoints: string[];
  requestHints: string[];
};

type Discovery = {
  source: string;
  status: number;
  bytes: number;
  formActions: string[];
  candidateEndpoints: string[];
  inputNames: string[];
  generateControls: string[];
  scriptHints: string[];
  externalScripts: string[];
  externalScriptDiagnostics: ScriptDiagnostic[];
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

function requestCandidates(base: string, text: string) {
  const endpoints = new Set<string>();
  const decoded = text
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\\//g, "/");
  const patterns = [
    /(?:url\s*:\s*|fetch\s*\(|axios\.(?:get|post)\s*\(|\.ajax\s*\(\s*\{[^}]{0,500}?url\s*:\s*)["'`]([^"'`]+)["'`]/gi,
    /["'`]([^"'`]*(?:GetRequest|DataExtract|Report|Extract|Export|Download)[^"'`]*)["'`]/gi,
  ];
  for (const pattern of patterns) {
    for (const match of decoded.matchAll(pattern)) {
      const raw = clean(match[1]);
      if (!raw || raw.length > 500 || /^#|^javascript:/i.test(raw)) continue;
      const url = absolute(base, raw);
      if (url && /(request|extract|report|export|download|data)/i.test(url)) endpoints.add(url);
    }
  }
  return [...endpoints].slice(0, 120);
}

function requestHints(text: string) {
  const flat = clean(text);
  const matches = flat.match(/.{0,220}(?:GetRequest[A-Za-z0-9_/-]*|Generate\s*Report|DataExtract|ajax\s*\(|fetch\s*\(|\.post\s*\(|\.get\s*\().{0,520}/gi) || [];
  return [...new Set(matches.map(v => clean(v).slice(0, 900)))].slice(0, 80);
}

async function inspectExternalScripts(base: string, urls: string[]): Promise<ScriptDiagnostic[]> {
  const out: ScriptDiagnostic[] = [];
  for (const url of urls.slice(0, 40)) {
    if (!/oeds|education\.ohio\.gov/i.test(url)) continue;
    try {
      const res = await fetch(url, {
        cache: "no-store",
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; Pursuit-Raven/9.1; authoritative-public-directory)",
          accept: "application/javascript,text/javascript,text/plain,*/*",
        },
      });
      const text = await res.text();
      const endpoints = requestCandidates(res.url || base, text);
      const hints = requestHints(text);
      if (endpoints.length || hints.length || /GetRequest|DataExtract/i.test(text)) {
        out.push({
          url: res.url || url,
          status: res.status,
          bytes: text.length,
          requestEndpoints: endpoints,
          requestHints: hints,
        });
      }
    } catch (error) {
      console.error("RAVEN_OH_OEDS_SCRIPT_FETCH", url, error instanceof Error ? error.message : String(error));
    }
  }
  return out;
}

async function discover(source: string, html: string, status: number): Promise<Discovery> {
  const $ = cheerio.load(html);
  const formActions = new Set<string>();
  const candidateEndpoints = new Set<string>();
  const inputNames = new Set<string>();
  const generateControls = new Set<string>();
  const scriptHints = new Set<string>();
  const externalScripts = new Set<string>();

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
    if ($(el).is("script") && url) externalScripts.add(url);
    if (url && /(extract|report|export|download|data)/i.test(url)) candidateEndpoints.add(url);
  });

  $("script").each((_, el) => {
    const text = clean($(el).html());
    if (!text || !/(generate\s*report|dataextract|report|export|download|ajax|fetch\()/i.test(text)) return;
    for (const hint of requestHints(text)) scriptHints.add(hint);
    for (const endpoint of requestCandidates(source, text)) candidateEndpoints.add(endpoint);
  });

  for (const action of formActions) candidateEndpoints.add(action);

  const externalScriptDiagnostics = await inspectExternalScripts(source, [...externalScripts]);
  for (const d of externalScriptDiagnostics) {
    for (const endpoint of d.requestEndpoints) candidateEndpoints.add(endpoint);
  }

  const body = clean($("body").text());
  return {
    source,
    status,
    bytes: html.length,
    formActions: [...formActions].slice(0, 20),
    candidateEndpoints: [...candidateEndpoints].slice(0, 160),
    inputNames: [...inputNames].slice(0, 300),
    generateControls: [...generateControls].slice(0, 40),
    scriptHints: [...scriptHints].slice(0, 80),
    externalScripts: [...externalScripts].slice(0, 100),
    externalScriptDiagnostics,
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
          "user-agent": "Mozilla/5.0 (compatible; Pursuit-Raven/9.1; authoritative-public-directory)",
          accept: "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5",
        },
      });
      const html = await res.text();
      diagnostics.push(await discover(res.url || source, html, res.status));
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
        externalScripts: [],
        externalScriptDiagnostics: [],
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
  const discoveredRequestEndpoints = [...new Set(diagnostics.flatMap(d => [
    ...d.formActions,
    ...d.externalScriptDiagnostics.flatMap(s => s.requestEndpoints),
  ]).filter(url => /GetRequest|Report|Extract/i.test(url)))];

  const body = usable
    ? {
        ok: false,
        state: "OH",
        source: usable.source,
        mode: "oeds-person-report-contract-discovery",
        blocker: discoveredRequestEndpoints.length
          ? "OEDS public person-report request endpoints have now been discovered from the live page and its external JavaScript. Database writes remain fail-closed until the exact POST payload is validated."
          : "OEDS is reachable and exposes the required public district/person/public-email fields, but the person-report request endpoint is still not visible after external-script inspection. Database writes remain fail-closed.",
        discoveredRequestEndpoints,
        diagnostics,
      }
    : {
        ok: false,
        state: "OH",
        mode: "oeds-person-report-contract-discovery",
        blocker: "No reachable OEDS DataExtract surface passed the public district/person/public-email confidence checks; no database writes performed.",
        discoveredRequestEndpoints,
        diagnostics,
      };

  console.error("RAVEN_OH_AUTHORITATIVE_DISCOVERY_JSON", JSON.stringify(body));
  return NextResponse.json(body, { status: 502 });
}
