import { load, type CheerioAPI } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const TEXAS_ESBD_URL = "https://www.txsmartbuy.gov/esbd";
const TEXAS_MAX_PAGES = 40;

const TEXAS_SOURCE: SledSourceConfig = {
  adapterKey: "texas_esbd_tx",
  sourceName: "Texas Electronic State Business Daily (ESBD)",
  baseUrl: TEXAS_ESBD_URL,
  jurisdiction: "Texas",
  sourceType: "website",
};

export interface TexasSyncResult {
  stateCode: "TX";
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  pagesFetched: number;
  totalPages: number | null;
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
  return response.text();
}

function parseCentralDate(dateValue: string, timeValue = "11:59 PM") {
  const dateText = text(dateValue);
  if (!dateText) return null;
  const month = Number(dateText.split("/")[0] || 0);
  const offset = month >= 3 && month <= 11 ? "GMT-0500" : "GMT-0600";
  const normalizedTime = text(timeValue).replace(/(\d{1,2}:\d{2})(am|pm)\b/i, "$1 $2");
  const parsed = new Date(`${dateText} ${normalizedTime} ${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extract(block: string, label: string, nextLabels: string[]) {
  const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const next = nextLabels.map(esc).join("|");
  const match = block.match(new RegExp(`${esc(label)}\\s*([\\s\\S]*?)(?=\\s*(?:${next})\\s*|$)`, "i"));
  return text(match?.[1] || "");
}

function findRecordContainer($: CheerioAPI, anchor: any) {
  let node = $(anchor);
  for (let depth = 0; depth < 9; depth += 1) {
    const parent = node.parent();
    if (!parent.length) break;
    const block = text(parent.text());
    if (/Solicitation ID:/i.test(block) && /Due Date:/i.test(block) && /Status:/i.test(block)) return parent;
    node = parent;
  }
  return $(anchor).parent();
}

function classifyType(title: string, solicitationId: string) {
  const value = `${solicitationId} ${title}`.toUpperCase();
  if (/\bRFI\b/.test(value)) return "RFI";
  if (/\bRFQ\b/.test(value)) return "RFQ";
  if (/\bRFP\b|RFPCSP/.test(value)) return "RFP";
  if (/\bIFB\b|\bITB\b/.test(value)) return "IFB";
  return "Public solicitation";
}

function parseTexasPage(html: string, pageUrl: string) {
  const $ = load(html);
  const body = text($("body").text());
  const totalPages = Number(body.match(/Page\s+\d+\s+of\s+(\d+)\s+Pages/i)?.[1] || 0) || null;
  const records: SledOpportunityRecord[] = [];
  const seen = new Set<string>();

  const labels = [
    "Due Date:",
    "Due Time:",
    "Agency/Texas SmartBuy Member Number:",
    "Status:",
    "Posting Date:",
    "Created Date:",
    "Last Updated:",
  ];

  $('a[href]').each((_, anchor) => {
    const href = $(anchor).attr("href") || "";
    if (!/^\/esbd\/[^/?#]+$/i.test(href)) return;
    const title = text($(anchor).text());
    if (!title) return;

    const container = findRecordContainer($, anchor);
    const block = text(container.text());
    const solicitationId = extract(block, "Solicitation ID:", labels);
    if (!solicitationId || seen.has(solicitationId)) return;
    seen.add(solicitationId);

    const dueDate = extract(block, "Due Date:", labels.slice(1));
    const dueTime = extract(block, "Due Time:", labels.slice(2));
    const memberNumber = extract(block, "Agency/Texas SmartBuy Member Number:", labels.slice(3));
    const statusText = extract(block, "Status:", labels.slice(4));
    const postingDate = extract(block, "Posting Date:", labels.slice(5));
    const createdDate = extract(block, "Created Date:", labels.slice(6));
    const lastUpdated = extract(block, "Last Updated:", []);
    const dueAt = parseCentralDate(dueDate, dueTime || "11:59 PM");

    if (!dueAt || new Date(dueAt).getTime() < Date.now()) return;
    if (/closed|cancel/i.test(statusText)) return;

    records.push({
      externalId: solicitationId,
      agency: {
        key: `texas-esbd:${memberNumber || "unknown"}`,
        name: memberNumber ? `Texas SmartBuy Member ${memberNumber}` : "Texas Public Purchasing Entity",
        agencyType: "public_entity",
        jurisdictionLevel: "state",
        stateCode: "TX",
        website: TEXAS_ESBD_URL,
      },
      title,
      solicitationType: classifyType(title, solicitationId),
      procurementMechanism: "Texas Electronic State Business Daily public solicitation",
      status: "open",
      issueDate: parseCentralDate(postingDate, "12:00 PM"),
      dueAt,
      stateCode: "TX",
      sourceUrl: absolute(pageUrl, href),
      rawPayload: {
        platform: "Texas SmartBuy ESBD",
        solicitationId,
        title,
        memberNumber: memberNumber || null,
        status: statusText || null,
        dueDate,
        dueTime: dueTime || null,
        postingDate: postingDate || null,
        createdDate: createdDate || null,
        lastUpdated: lastUpdated || null,
        sourcePage: pageUrl,
        captureWindowPages: TEXAS_MAX_PAGES,
      },
    });
  });

  return { records, totalPages };
}

async function fetchTexasRecentActive() {
  const all: SledOpportunityRecord[] = [];
  let totalPages: number | null = null;
  let pagesFetched = 0;
  const batchSize = 5;

  for (let start = 1; start <= TEXAS_MAX_PAGES; start += batchSize) {
    const pageNumbers = Array.from({ length: Math.min(batchSize, TEXAS_MAX_PAGES - start + 1) }, (_, index) => start + index);
    const pages = await Promise.all(pageNumbers.map(async pageNumber => {
      const url = pageNumber === 1 ? TEXAS_ESBD_URL : `${TEXAS_ESBD_URL}?page=${pageNumber}`;
      const parsed = parseTexasPage(await fetchHtml(url), url);
      return { pageNumber, ...parsed };
    }));

    for (const page of pages) {
      pagesFetched += 1;
      totalPages ||= page.totalPages;
      all.push(...page.records);
    }
  }

  return {
    pagesFetched,
    totalPages,
    records: [...new Map(all.map(record => [record.externalId, record])).values()],
  };
}

export async function syncTexasEsbd(bootstrap = false): Promise<TexasSyncResult> {
  try {
    const { pagesFetched, totalPages, records } = await fetchTexasRecentActive();
    if (!records.length) throw new Error("No current Texas ESBD solicitations were parsed from the recent-active window");
    const persisted = await persistSledOpportunities(TEXAS_SOURCE, records, {
      mode: bootstrap ? "texas_esbd_bootstrap" : "texas_esbd_refresh",
      recordChanges: !bootstrap,
    });
    return {
      stateCode: "TX",
      sourceName: TEXAS_SOURCE.sourceName,
      ok: true,
      rowsFound: records.length,
      pagesFetched,
      totalPages,
      ...persisted,
      pageLimited: Boolean(totalPages && totalPages > pagesFetched),
    };
  } catch (error) {
    return {
      stateCode: "TX",
      sourceName: TEXAS_SOURCE.sourceName,
      ok: false,
      rowsFound: 0,
      pagesFetched: 0,
      totalPages: null,
      stored: 0,
      newRecords: 0,
      changedRecords: 0,
      pageLimited: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
