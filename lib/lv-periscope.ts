import { load } from "cheerio";
import type { SledOpportunityRecord } from "@/lib/sled/types";
import { classifyLowVoltage } from "@/lib/lv-classifier";

export type LVPeriscopeState = "MA" | "IL" | "OR";

type StateConfig = {
  stateCode: LVPeriscopeState;
  stateName: string;
  baseUrl: string;
  sourceName: string;
};

const STATES: Record<LVPeriscopeState, StateConfig> = {
  MA: { stateCode: "MA", stateName: "Massachusetts", baseUrl: "https://www.commbuys.com/bso/", sourceName: "Massachusetts COMMBUYS" },
  IL: { stateCode: "IL", stateName: "Illinois", baseUrl: "https://www.bidbuy.illinois.gov/bso/", sourceName: "Illinois BidBuy" },
  OR: { stateCode: "OR", stateName: "Oregon", baseUrl: "https://oregonbuys.gov/bso/", sourceName: "OregonBuys" },
};

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
  return [...map.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function agencyClass(name: string) {
  const normalized = name.toLowerCase();
  if (/school district|public schools|school department|board of education|elementary|secondary education/.test(normalized)) return { agencyType: "k12", jurisdictionLevel: "local" };
  if (/university|college|community college|higher education/.test(normalized)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/county/.test(normalized)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/city of|town of|village of|borough of|municipal/.test(normalized)) return { agencyType: "municipality", jurisdictionLevel: "local" };
  if (/authority|commission|district/.test(normalized)) return { agencyType: "authority", jurisdictionLevel: "local" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

function sourcePage(config: StateConfig) {
  return new URL("view/search/external/advancedSearchBid.xhtml?openBids=true", config.baseUrl).toString();
}

function parseRows(html: string, config: StateConfig, fragment = false) {
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
    const agency = cell(2);
    const buyer = cell(5);
    const title = cell(6);
    const dueText = cell(7);
    const statusText = cells.length > 10 ? cell(10) : "";
    const alternateId = cells.length > 11 ? cell(11) : "";
    if (!externalId || !agency || !title || !dueText || /Bid Solicitation #/i.test(externalId)) return;
    sourceRowsSeen += 1;

    const dueAt = isoDate(dueText);
    if (dueAt && new Date(dueAt).getTime() < Date.now()) return;
    const href = $(cells[0]).find("a").first().attr("href");
    const classification = agencyClass(agency);

    records.push({
      externalId: `${config.stateCode}:${externalId}`,
      agency: {
        key: `periscope:${config.stateCode}:${agency}`,
        name: agency,
        agencyType: classification.agencyType,
        jurisdictionLevel: classification.jurisdictionLevel,
        stateCode: config.stateCode,
        website: config.baseUrl,
      },
      title,
      description: null,
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
        organization: agency,
        buyer: buyer || null,
        description: title,
        bidOpeningDate: dueText,
        status: statusText || null,
        alternateId: alternateId || null,
        sourcePage: sourcePage(config),
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
    return { resultCount, pageSize };
  }

  const script = $("script").toArray().map(node => $(node).html() || "").find(value => /advancedResultsTable/.test(value)) || "";
  return {
    resultCount: Number(script.match(/rowCount\s*:\s*(\d+)/)?.[1] || 0) || null,
    pageSize: Number(script.match(/rows\s*:\s*(\d+)/)?.[1] || 0) || null,
  };
}

function serializeForm(html: string) {
  const $ = load(html);
  const form = $("#bidSearchResultsForm");
  if (!form.length) throw new Error("Periscope result form not found");
  const params = new URLSearchParams();

  form.find("input[name]").each((_, node) => {
    const input = $(node);
    const key = input.attr("name");
    if (!key) return;
    const type = (input.attr("type") || "text").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !input.is(":checked")) return;
    if (["submit", "button", "image", "file"].includes(type)) return;
    params.append(key, input.attr("value") || "");
  });
  form.find("select[name]").each((_, node) => {
    const select = $(node);
    const key = select.attr("name");
    if (!key) return;
    select.find("option:selected").each((__, option) => params.append(key, $(option).attr("value") || ""));
  });
  form.find("textarea[name]").each((_, node) => {
    const field = $(node);
    const key = field.attr("name");
    if (key) params.append(key, field.text());
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

async function fetchAll(config: StateConfig, maxPages = 50) {
  const url = sourcePage(config);
  const initial = await fetch(url, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 Pursuit-LV/1.0" },
    redirect: "follow",
    cache: "no-store",
  });
  if (!initial.ok) throw new Error(`${config.sourceName} returned ${initial.status}`);

  const initialHtml = await initial.text();
  const info = paginatorInfo(initialHtml);
  const firstParsed = parseRows(initialHtml, config);
  const built = serializeForm(initialHtml);
  const component = "bidSearchResultsForm:bidResultId";
  const postUrl = new URL(built.action || initial.url, initial.url).toString();
  let cookie = cookieHeader(initial.headers.get("set-cookie"));
  let viewState = built.params.get("javax.faces.ViewState") || "";
  let sourceRowsSeen = firstParsed.sourceRowsSeen;
  const records = [...firstParsed.records];

  const resultCount = info.resultCount ?? firstParsed.sourceRowsSeen;
  const pageSize = info.pageSize ?? Math.max(1, firstParsed.sourceRowsSeen);
  const allowedRows = Math.min(resultCount, pageSize * Math.max(1, maxPages));

  for (let first = pageSize; first < allowedRows; first += pageSize) {
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
        "user-agent": "Mozilla/5.0 Pursuit-LV/1.0",
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

  return {
    records: [...new Map(records.map(record => [record.externalId, record])).values()],
    sourceRowsSeen,
    resultCount,
    complete: sourceRowsSeen >= resultCount,
  };
}

export async function discoverPeriscopeLV(stateCode: LVPeriscopeState = "MA", maxPages = 50) {
  const config = STATES[stateCode];
  const fetched = await fetchAll(config, maxPages);
  const classified = fetched.records
    .map(opportunity => ({ opportunity, classification: classifyLowVoltage({ title: opportunity.title, description: opportunity.description }) }))
    .filter(item => item.classification.accepted)
    .sort((a, b) => b.classification.score - a.classification.score);

  return {
    stateCode,
    sourceName: config.sourceName,
    scanned: fetched.records.length,
    sourceRowsSeen: fetched.sourceRowsSeen,
    resultCount: fetched.resultCount,
    complete: fetched.complete,
    pursuits: classified,
  };
}
