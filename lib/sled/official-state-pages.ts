import { load } from "cheerio";
import { getSql } from "@/lib/db";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const INDIANA_URL = "https://www.in.gov/idoa/procurement/current-business-opportunities/index.html";
const TENNESSEE_URL = "https://hub.edison.tn.gov/psc/fsprd/SUPPLIER/ERP/c/SCP_PUBLIC_MENU_FL.SCP_PUB_BID_CMP_FL.GBL";

const INDIANA_SOURCE: SledSourceConfig = {
  adapterKey: "indiana_idoa",
  sourceName: "Indiana IDOA Current Business Opportunities",
  baseUrl: INDIANA_URL,
  jurisdiction: "Indiana",
  sourceType: "website",
};

const TENNESSEE_SOURCE: SledSourceConfig = {
  adapterKey: "tennessee_edison",
  sourceName: "Tennessee Edison Public Bid Board",
  baseUrl: TENNESSEE_URL,
  jurisdiction: "Tennessee",
  sourceType: "website",
};

export interface StatePageSyncResult {
  source: string;
  adapterKey: string;
  rowsFound: number;
  stored: number;
  newRecords: number;
  changedRecords: number;
  ok: boolean;
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
  const normalized = value.replace(/\bEST\b/g, "GMT-0500").replace(/\bEDT\b/g, "GMT-0400").replace(/\bCST\b/g, "GMT-0600").replace(/\bCDT\b/g, "GMT-0500");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const html = await response.text();
  return { html, finalUrl: response.url };
}

function parseIndiana(html: string): SledOpportunityRecord[] {
  const $ = load(html);
  const records: SledOpportunityRecord[] = [];

  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 6) return;
    const cell = (index: number) => text($(cells[index]).text());
    const eventId = cell(2);
    const agency = cell(1);
    const description = cell(3);
    const dueText = cell(4);
    if (!eventId || !agency || !dueText || !/\d/.test(eventId)) return;

    const eventCell = $(cells[0]);
    const links = eventCell.find("a").toArray();
    const titleAnchor = links.find(a => !/bid documents?/i.test(text($(a).text())));
    const title = text(titleAnchor ? $(titleAnchor).text() : eventCell.clone().find("a").remove().end().text()) || cell(0);
    if (!title || /event name/i.test(title)) return;

    const href = titleAnchor ? $(titleAnchor).attr("href") : eventCell.find("a").first().attr("href");
    records.push({
      externalId: eventId,
      agency: {
        key: `indiana:${agency}`,
        name: `State of Indiana - ${agency}`,
        agencyType: "state_agency",
        jurisdictionLevel: "state",
        stateCode: "IN",
        city: "Indianapolis",
        website: "https://www.in.gov/",
      },
      title,
      description: description || null,
      solicitationType: /^RFP|^RFQ|^RFS|^IFB|^ITB/i.test(title) ? title.split(/\s+/)[0] : "State solicitation",
      procurementMechanism: "Indiana state solicitation",
      status: "open",
      dueAt: isoDate(dueText),
      stateCode: "IN",
      city: "Indianapolis",
      sourceUrl: absolute(INDIANA_URL, href),
      rawPayload: {
        platform: "Indiana IDOA",
        eventId,
        title,
        agency,
        description,
        responseDueBy: dueText,
        contact: cell(5),
        sourcePage: INDIANA_URL,
      },
    });
  });

  return [...new Map(records.map(record => [record.externalId, record])).values()];
}

function parseTennessee(html: string): SledOpportunityRecord[] {
  const $ = load(html);
  const records: SledOpportunityRecord[] = [];

  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 8) return;
    const cell = (index: number) => text($(cells[index]).text());
    const title = cell(0);
    const businessUnit = cell(1);
    const eventId = cell(2);
    const eventFormat = cell(3);
    const eventType = cell(4);
    const startText = cell(6);
    const endText = cell(7);
    if (!title || !businessUnit || !eventId || !/^\d{6,}$/.test(eventId.replace(/\s/g, ""))) return;

    const dueAt = isoDate(endText);
    if (dueAt && new Date(dueAt).getTime() < Date.now()) return;
    const href = $(cells[8] || cells[0]).find("a").first().attr("href") || $(cells[0]).find("a").first().attr("href");

    records.push({
      externalId: eventId,
      agency: {
        key: `tennessee:${businessUnit}`,
        name: `State of Tennessee - ${businessUnit}`,
        agencyType: "state_agency",
        jurisdictionLevel: "state",
        stateCode: "TN",
        city: "Nashville",
        website: "https://www.tn.gov/",
      },
      title,
      solicitationType: eventType || "RFx",
      procurementMechanism: eventFormat || "Tennessee state solicitation",
      status: "open",
      issueDate: isoDate(startText),
      dueAt,
      stateCode: "TN",
      city: "Nashville",
      sourceUrl: absolute(TENNESSEE_URL, href),
      rawPayload: {
        platform: "Tennessee Edison",
        eventName: title,
        businessUnit,
        eventId,
        eventFormat,
        eventType,
        starts: startText,
        ends: endText,
        sourcePage: TENNESSEE_URL,
      },
    });
  });

  return [...new Map(records.map(record => [record.externalId, record])).values()];
}

async function closeMissing(adapterKey: string, startedAt: string) {
  const sql = getSql();
  await sql.query(
    `update opportunities o set status='closed'
     from sources s
     where o.source_id=s.id and s.adapter_key=$1 and o.status='open' and o.last_seen_at < $2::timestamptz`,
    [adapterKey, startedAt],
  );
}

async function syncOne(
  source: SledSourceConfig,
  url: string,
  parser: (html: string) => SledOpportunityRecord[],
  bootstrap: boolean,
): Promise<StatePageSyncResult> {
  const startedAt = new Date().toISOString();
  try {
    const { html, finalUrl } = await fetchHtml(url);
    if (/identity\.oraclecloud\.com|\/oauth2\/v1\/authorize/i.test(finalUrl)) {
      throw new Error(`Public source redirected to authentication: ${finalUrl}`);
    }
    const records = parser(html);
    if (!records.length) throw new Error("No current solicitation rows were parsed from the public page");
    const result = await persistSledOpportunities(source, records, {
      mode: bootstrap ? "state_page_bootstrap" : "state_page_daily",
      recordChanges: !bootstrap,
    });
    await closeMissing(source.adapterKey, startedAt);
    return { source: source.sourceName, adapterKey: source.adapterKey, rowsFound: records.length, ...result, ok: true };
  } catch (error) {
    return {
      source: source.sourceName,
      adapterKey: source.adapterKey,
      rowsFound: 0,
      stored: 0,
      newRecords: 0,
      changedRecords: 0,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function syncOfficialStatePages(bootstrap = false) {
  return Promise.all([
    syncOne(INDIANA_SOURCE, INDIANA_URL, parseIndiana, bootstrap),
    syncOne(TENNESSEE_SOURCE, TENNESSEE_URL, parseTennessee, bootstrap),
  ]);
}
