import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

interface PeriscopeStateConfig {
  stateCode: string;
  stateName: string;
  baseUrl: string;
  sourceName: string;
}

const PERISCOPE_STATES: PeriscopeStateConfig[] = [
  { stateCode: "IL", stateName: "Illinois", baseUrl: "https://www.bidbuy.illinois.gov/bso/", sourceName: "Illinois BidBuy" },
  { stateCode: "MA", stateName: "Massachusetts", baseUrl: "https://www.commbuys.com/bso/", sourceName: "Massachusetts COMMBUYS" },
  { stateCode: "NV", stateName: "Nevada", baseUrl: "https://nevadaepro.com/bso/", sourceName: "NevadaEPro" },
  { stateCode: "NJ", stateName: "New Jersey", baseUrl: "https://www.njstart.gov/bso/", sourceName: "New Jersey NJSTART" },
  { stateCode: "OR", stateName: "Oregon", baseUrl: "https://oregonbuys.gov/bso/", sourceName: "OregonBuys" },
];

export interface PeriscopeProbeResult {
  stateCode: string;
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  sourceRowsSeen: number;
  resultCount: number | null;
  pageCount: number | null;
  complete: boolean;
  sample: Array<{ externalId: string; agency: string; title: string; dueAt: string | null }>;
  error?: string;
}

function text(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function absolute(base: string, href?: string) {
  if (!href || href.startsWith("javascript:")) return base;
  try { return new URL(href, base).toString(); } catch { return base; }
}

function isoDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function cookieHeader(setCookie: string | null) {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=[^;,]+=)/)
    .map(part => part.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function mergeCookies(existing: string, setCookie: string | null) {
  const map = new Map<string, string>();
  for (const header of [existing, cookieHeader(setCookie)]) {
    for (const item of header.split(";").map(piece => piece.trim()).filter(Boolean)) {
      const separator = item.indexOf("=");
      if (separator <= 0) continue;
      map.set(item.slice(0, separator), item.slice(separator + 1));
    }
  }
  return [...map.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function classifyAgency(name: string) {
  const normalized = name.toLowerCase();
  if (/school district|public schools|school department|board of education|elementary|secondary education/.test(normalized)) {
    return { agencyType: "k12", jurisdictionLevel: "local" };
  }
  if (/university|college|community college|higher education/.test(normalized)) {
    return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  }
  if (/county/.test(normalized)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/city of|town of|village of|borough of|municipal/.test(normalized)) {
    return { agencyType: "municipality", jurisdictionLevel: "local" };
  }
  if (/authority|commission|district/.test(normalized)) return { agencyType: "authority", jurisdictionLevel: "local" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

function sourcePage(config: PeriscopeStateConfig) {
  return new URL("view/search/external/advancedSearchBid.xhtml?openBids=true", config.baseUrl).toString();
}

function parseRows(html: string, config: PeriscopeStateConfig, fragment = false) {
  const $ = load(fragment ? `<table><tbody>${html}</tbody></table>` : html);
  let rows = fragment ? $("tbody tr") : $("table").filter((_, table) => {
    const header = text($(table).find("tr").first().text());
    return /Bid Solicitation #/i.test(header) && /Description/i.test(header) && /Bid Opening Date/i.test(header);
  }).first().find("tbody tr");

  if (!rows.length && !fragment) {
    rows = $("table").filter((_, table) => /Bid search results/i.test(text($(table).parent().text()))).first().find("tbody tr");
  }

  const records: SledOpportunityRecord[] = [];
  let sourceRowsSeen = 0;

  rows.each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 8) return;
    const cell = (index: number) => text($(cells[index]).text());
    const externalId = cell(1) || cell(0);
    const agencyName = cell(2);
    const buyer = cell(5);
    const title = cell(6);
    const dueText = cell(7);
    const statusText = cells.length > 10 ? cell(10) : "";
    const alternateId = cells.length > 11 ? cell(11) : "";
    if (!externalId || !agencyName || !title || !dueText || /Bid Solicitation #/i.test(externalId)) return;
    sourceRowsSeen += 1;

    const dueAt = isoDate(dueText);
    if (dueAt && new Date(dueAt).getTime() < Date.now()) return;
    const href = $(cells[0]).find("a").first().attr("href");
    const agencyClass = classifyAgency(agencyName);

    records.push({
      externalId,
      agency: {
        key: `periscope:${config.stateCode}:${agencyName}`,
        name: agencyName,
        agencyType: agencyClass.agencyType,
        jurisdictionLevel: agencyClass.jurisdictionLevel,
        stateCode: config.stateCode,
        website: config.baseUrl,
      },
      title,
      solicitationType: "Bid solicitation",
      procurementMechanism: "Periscope S2G public solicitation",
      status: "open",
      dueAt,
      stateCode: config.stateCode,
      sourceUrl: absolute(config.baseUrl, href),
      rawPayload: {
        platform: "Periscope S2G",
        state: config.stateName,
        solicitationNumber: externalId,
        organization: agencyName,
        buyer: buyer || null,
        description: title,
        bidOpeningDate: dueText,
        status: statusText || null,
        alternateId: alternateId || null,
        sourcePage: sourcePage(config),
        pageLimited: true,
      },
    });
  });

  return { records, sourceRowsSeen };
}

function paginatorInfo(html: string) {
  const $ = load(html);
  const current = text($(".ui-paginator-current").first().text());
  const match = current.match(/(\d+)\s*-\s*(\d+)\s*of\s*(\d+)/i);
  if (match) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    const resultCount = Number(match[3]);
    const pageSize = Math.max(1, end - start + 1);
    return { resultCount, pageSize, pageCount: Math.ceil(resultCount / pageSize) };
  }

  const script = $("script").toArray().map(node => $(node).html() || "").find(value => /advancedResultsTable/.test(value)) || "";
  const resultCount = Number(script.match(/rowCount\s*:\s*(\d+)/)?.[1] || 0) || null;
  const pageSize = Number(script.match(/rows\s*:\s*(\d+)/)?.[1] || 0) || null;
  return {
    resultCount,
    pageSize,
    pageCount: resultCount && pageSize ? Math.ceil(resultCount / pageSize) : null,
  };
}

function serializeResultForm(html: string) {
  const $ = load(html);
  const form = $("#bidSearchResultsForm");
  if (!form.length) throw new Error("Periscope bidSearchResultsForm was not found");
  const params = new URLSearchParams();

  form.find("input[name]").each((_, node) => {
    const input = $(node);
    const name = input.attr("name");
    if (!name) return;
    const type = (input.attr("type") || "text").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !input.is(":checked")) return;
    if (["submit", "button", "image", "file"].includes(type)) return;
    params.append(name, input.attr("value") || "");
  });

  form.find("select[name]").each((_, node) => {
    const select = $(node);
    const name = select.attr("name");
    if (!name) return;
    select.find("option:selected").each((__, option) => params.append(name, $(option).attr("value") || ""));
  });

  form.find("textarea[name]").each((_, node) => {
    const field = $(node);
    const name = field.attr("name");
    if (name) params.append(name, field.text());
  });

  if (!params.has("bidSearchResultsForm")) params.set("bidSearchResultsForm", "bidSearchResultsForm");
  return { action: form.attr("action") || "", params };
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function extractUpdate(xml: string, id: string) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cdata = xml.match(new RegExp(`<update[^>]+id=["']${escaped}["'][^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/update>`));
  if (cdata) return cdata[1];
  const plain = xml.match(new RegExp(`<update[^>]+id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/update>`));
  return plain ? decodeXml(plain[1]) : null;
}

function extractViewState(xml: string) {
  const cdata = xml.match(/<update[^>]+id=["'][^"']*javax\.faces\.ViewState[^"']*["'][^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/update>/);
  if (cdata) return cdata[1];
  const plain = xml.match(/<update[^>]+id=["'][^"']*javax\.faces\.ViewState[^"']*["'][^>]*>([\s\S]*?)<\/update>/);
  return plain ? decodeXml(plain[1]) : null;
}

async function fetchFullOpenBids(config: PeriscopeStateConfig) {
  const url = sourcePage(config);
  const initial = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!initial.ok) throw new Error(`${config.sourceName} returned ${initial.status}`);

  const initialHtml = await initial.text();
  const info = paginatorInfo(initialHtml);
  const parsedInitial = parseRows(initialHtml, config);
  const built = serializeResultForm(initialHtml);
  const component = "bidSearchResultsForm:bidResultId";
  const postUrl = new URL(built.action || initial.url, initial.url).toString();
  let cookie = cookieHeader(initial.headers.get("set-cookie"));
  let viewState = built.params.get("javax.faces.ViewState") || "";
  let sourceRowsSeen = parsedInitial.sourceRowsSeen;
  const records = [...parsedInitial.records];

  const resultCount = info.resultCount ?? parsedInitial.sourceRowsSeen;
  const pageSize = info.pageSize ?? Math.max(1, parsedInitial.sourceRowsSeen);
  const pageCount = resultCount ? Math.ceil(resultCount / pageSize) : 1;

  for (let first = pageSize; first < resultCount; first += pageSize) {
    const body = new URLSearchParams(built.params.toString());
    if (viewState) body.set("javax.faces.ViewState", viewState);
    body.set("javax.faces.partial.ajax", "true");
    body.set("javax.faces.source", component);
    body.set("javax.faces.partial.execute", component);
    body.set("javax.faces.partial.render", component);
    body.set(component, component);
    body.set(`${component}_pagination`, "true");
    body.set(`${component}_first`, String(first));
    body.set(`${component}_rows`, String(pageSize));
    body.set(`${component}_skipChildren`, "true");
    body.set(`${component}_encodeFeature`, "true");

    const response = await fetch(postUrl, {
      method: "POST",
      headers: {
        accept: "application/xml, text/xml, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "faces-request": "partial/ajax",
        "x-requested-with": "XMLHttpRequest",
        origin: new URL(initial.url).origin,
        referer: initial.url,
        ...(cookie ? { cookie } : {}),
        "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
      },
      body,
      redirect: "follow",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`${config.sourceName} page ${Math.floor(first / pageSize) + 1} returned ${response.status}`);

    const xml = await response.text();
    const fragment = extractUpdate(xml, component);
    if (!fragment) throw new Error(`${config.sourceName} page ${Math.floor(first / pageSize) + 1} returned no result fragment`);
    const parsed = parseRows(fragment, config, true);
    sourceRowsSeen += parsed.sourceRowsSeen;
    records.push(...parsed.records);
    viewState = extractViewState(xml) || viewState;
    cookie = mergeCookies(cookie, response.headers.get("set-cookie"));
  }

  const complete = sourceRowsSeen === resultCount;
  const unique = [...new Map(records.map(record => [record.externalId, record])).values()].map(record => ({
    ...record,
    rawPayload: { ...record.rawPayload, pageLimited: !complete },
  }));

  return { records: unique, sourceRowsSeen, resultCount, pageSize, pageCount, complete };
}

export async function probePeriscopeStates(): Promise<PeriscopeProbeResult[]> {
  const results: PeriscopeProbeResult[] = [];
  for (const config of PERISCOPE_STATES) {
    try {
      const { records, sourceRowsSeen, resultCount, pageCount, complete } = await fetchFullOpenBids(config);
      results.push({
        stateCode: config.stateCode,
        sourceName: config.sourceName,
        ok: records.length > 0,
        rowsFound: records.length,
        sourceRowsSeen,
        resultCount,
        pageCount,
        complete,
        sample: records.slice(0, 3).map(record => ({
          externalId: record.externalId,
          agency: record.agency.name,
          title: record.title,
          dueAt: record.dueAt || null,
        })),
        ...(records.length ? {} : { error: "No open bid rows parsed" }),
      });
    } catch (error) {
      results.push({
        stateCode: config.stateCode,
        sourceName: config.sourceName,
        ok: false,
        rowsFound: 0,
        sourceRowsSeen: 0,
        resultCount: null,
        pageCount: null,
        complete: false,
        sample: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export async function syncPeriscopeFullSweeps() {
  const results = [];
  for (const config of PERISCOPE_STATES) {
    try {
      const { records, sourceRowsSeen, resultCount, pageCount, complete } = await fetchFullOpenBids(config);
      if (!records.length) throw new Error("No open bid rows parsed");
      const source: SledSourceConfig = {
        adapterKey: `periscope_${config.stateCode.toLowerCase()}`,
        sourceName: config.sourceName,
        baseUrl: config.baseUrl,
        jurisdiction: config.stateName,
        sourceType: "portal",
      };
      const persisted = await persistSledOpportunities(source, records, {
        mode: complete ? "periscope_full_sweep" : "periscope_partial_sweep",
        recordChanges: true,
      });
      results.push({ stateCode: config.stateCode, ok: true, rowsFound: records.length, sourceRowsSeen, resultCount, pageCount, complete, ...persisted, pageLimited: !complete });
    } catch (error) {
      results.push({ stateCode: config.stateCode, ok: false, rowsFound: 0, sourceRowsSeen: 0, resultCount: null, pageCount: null, complete: false, stored: 0, newRecords: 0, changedRecords: 0, pageLimited: true, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
