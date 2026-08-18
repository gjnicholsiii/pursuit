import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const KANSAS_BIDS_URL = "https://supplier.sok.ks.gov/psc/sokfsprdsup/SUPPLIER/ERP/c/SCP_PUBLIC_MENU_FL.SCP_PUB_BID_CMP_FL.GBL?page=SCP_PUB_BIDLIST_FL";

const KANSAS_SOURCE: SledSourceConfig = {
  adapterKey: "peoplesoft_ks",
  sourceName: "Kansas eSupplier Public Bid Events",
  baseUrl: KANSAS_BIDS_URL,
  jurisdiction: "Kansas",
  sourceType: "portal",
};

export interface KansasSyncResult {
  stateCode: "KS";
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  stored: number;
  newRecords: number;
  changedRecords: number;
  pageLimited: boolean;
  error?: string;
}

function text(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function absolute(base: string, href?: string) {
  if (!href || href.startsWith("javascript:")) return base;
  try { return new URL(href, base).toString(); } catch { return base; }
}

function parseKansasDate(value: string) {
  const cleaned = text(value);
  if (!cleaned) return null;
  const normalized = cleaned
    .replace(/\bCST\b/g, "GMT-0600")
    .replace(/\bCDT\b/g, "GMT-0500");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function classifyAgency(name: string) {
  const n = name.toLowerCase();
  if (/school|education|academy/.test(n)) return { agencyType: "k12", jurisdictionLevel: "state" };
  if (/university|college/.test(n)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/county/.test(n)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/city|town|village|municipal/.test(n)) return { agencyType: "municipality", jurisdictionLevel: "local" };
  if (/authority|commission|district|board/.test(n)) return { agencyType: "authority", jurisdictionLevel: "state" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

async function fetchKansasHtml() {
  const response = await fetch(KANSAS_BIDS_URL, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Kansas eSupplier returned ${response.status}`);
  return { html: await response.text(), finalUrl: response.url };
}

function parseKansas(html: string, finalUrl: string): SledOpportunityRecord[] {
  const $ = load(html);
  const records: SledOpportunityRecord[] = [];

  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 6) return;
    const cell = (index: number) => text($(cells[index]).text());

    const title = cell(0);
    const agencyName = cell(1);
    const eventId = cell(2);
    const startText = cell(4);
    const endText = cell(5);
    if (!title || !agencyName || !eventId || !/^EVT\d+/i.test(eventId)) return;

    const dueAt = parseKansasDate(endText);
    if (dueAt && new Date(dueAt).getTime() < Date.now()) return;
    const issueDate = parseKansasDate(startText);
    const linkCell = cells.length > 6 ? $(cells[6]) : $(cells[0]);
    const href = linkCell.find("a").first().attr("href") || $(cells[0]).find("a").first().attr("href");
    const agencyClass = classifyAgency(agencyName);

    records.push({
      externalId: eventId,
      agency: {
        key: `kansas:${agencyName}`,
        name: agencyName,
        agencyType: agencyClass.agencyType,
        jurisdictionLevel: agencyClass.jurisdictionLevel,
        stateCode: "KS",
        website: KANSAS_BIDS_URL,
      },
      title,
      solicitationType: /\brfp\b|request for proposal/i.test(title) ? "RFP"
        : /\brfq\b|request for quotation/i.test(title) ? "RFQ"
        : /\brfi\b|request for information/i.test(title) ? "RFI"
        : /\bitb\b|invitation to bid/i.test(title) ? "ITB"
        : "Bid Event",
      procurementMechanism: "Kansas PeopleSoft eSupplier public bid event",
      status: "open",
      issueDate,
      dueAt,
      stateCode: "KS",
      sourceUrl: absolute(finalUrl, href),
      rawPayload: {
        platform: "PeopleSoft eSupplier",
        state: "Kansas",
        eventName: title,
        businessUnit: agencyName,
        eventId,
        startsAt: startText || null,
        endsAt: endText || null,
        sourcePage: KANSAS_BIDS_URL,
      },
    });
  });

  return [...new Map(records.map(record => [record.externalId, record])).values()];
}

export async function syncKansasPeopleSoft(): Promise<KansasSyncResult> {
  try {
    const page = await fetchKansasHtml();
    const records = parseKansas(page.html, page.finalUrl);
    if (!records.length) throw new Error("No current Kansas public bid events were parsed");
    const persisted = await persistSledOpportunities(KANSAS_SOURCE, records, {
      mode: "peoplesoft_kansas_public",
      recordChanges: true,
      closeMissing: true,
    });
    return {
      stateCode: "KS",
      sourceName: KANSAS_SOURCE.sourceName,
      ok: true,
      rowsFound: records.length,
      ...persisted,
      pageLimited: false,
    };
  } catch (error) {
    return {
      stateCode: "KS",
      sourceName: KANSAS_SOURCE.sourceName,
      ok: false,
      rowsFound: 0,
      stored: 0,
      newRecords: 0,
      changedRecords: 0,
      pageLimited: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
