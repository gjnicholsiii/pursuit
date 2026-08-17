import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const NEBRASKA_URL = "https://das.nebraska.gov/materiel/bid-opportunities.html";
const LOUISIANA_DEPARTMENTS_URL = "https://wwwcfprd.doa.louisiana.gov/OSP/LaPAC/deptbids.cfm";

const NEBRASKA_SOURCE: SledSourceConfig = {
  adapterKey: "nebraska_das_ne",
  sourceName: "Nebraska DAS Current Bid Opportunities",
  baseUrl: NEBRASKA_URL,
  jurisdiction: "Nebraska",
  sourceType: "website",
};

const LOUISIANA_SOURCE: SledSourceConfig = {
  adapterKey: "louisiana_lapac_la",
  sourceName: "Louisiana LaPAC Open Solicitations",
  baseUrl: "https://wwwcfprd.doa.louisiana.gov/OSP/LaPAC/pubMain.cfm",
  jurisdiction: "Louisiana",
  sourceType: "website",
};

export interface DirectStateBoardResult {
  stateCode: string;
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
  return { html: await response.text(), finalUrl: response.url };
}

function parseUsDate(value: string, zone: "central" | "mountain" = "central") {
  const cleaned = text(value);
  if (!cleaned || /continuous/i.test(cleaned)) return null;
  const normalized = cleaned
    .replace(/\bCT\b/g, zone === "central" ? "GMT-0500" : "GMT-0600")
    .replace(/\bCST\b/g, "GMT-0600")
    .replace(/\bCDT\b/g, "GMT-0500")
    .replace(/\bMST\b/g, "GMT-0700")
    .replace(/\bMDT\b/g, "GMT-0600");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseNebraskaDateOnly(value: string, endOfDay = false) {
  const match = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return parseUsDate(value);
  const [, m, d, y] = match;
  const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
  // Nebraska is Central Time. Noon anchor avoids DST boundary ambiguity for date-only postings.
  const hour = endOfDay ? 23 : 12;
  const localApprox = new Date(Date.UTC(year, Number(m) - 1, Number(d), hour + 5, endOfDay ? 59 : 0, endOfDay ? 59 : 0));
  return localApprox.toISOString();
}

function classifyAgency(name: string) {
  const n = name.toLowerCase();
  if (/school|education/.test(n)) return { agencyType: "k12", jurisdictionLevel: "state" };
  if (/university|college/.test(n)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/county/.test(n)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/city|town|village|municipal/.test(n)) return { agencyType: "municipality", jurisdictionLevel: "local" };
  if (/authority|commission|district|port/.test(n)) return { agencyType: "authority", jurisdictionLevel: "state" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

function parseNebraska(html: string): SledOpportunityRecord[] {
  const $ = load(html);
  let table = $("h3, h4").filter((_, node) => /current bid opportunities/i.test(text($(node).text()))).first().nextAll("table").first();
  if (!table.length) {
    table = $("table").filter((_, node) => /posted/i.test(text($(node).find("tr").first().text())) && /solicitation number/i.test(text($(node).find("tr").first().text()))).first();
  }

  const records: SledOpportunityRecord[] = [];
  table.find("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 8) return;
    const cell = (index: number) => text($(cells[index]).text());
    const posted = cell(0);
    const title = cell(1);
    const category = cell(2);
    const opening = cell(3);
    const type = cell(4);
    const buyer = cell(5);
    const externalId = cell(6);
    const agencyName = cell(7);
    const updated = cells.length > 8 ? cell(8) : "";
    if (!externalId || !title || !agencyName || /solicitation number/i.test(externalId)) return;

    const dueAt = parseNebraskaDateOnly(opening, true);
    if (dueAt && new Date(dueAt).getTime() < Date.now()) return;
    const issueDate = parseNebraskaDateOnly(posted);
    const href = $(cells[1]).find("a").first().attr("href") || $(cells[6]).find("a").first().attr("href");
    const agencyClass = classifyAgency(agencyName);

    records.push({
      externalId,
      agency: {
        key: `nebraska:${agencyName}`,
        name: agencyName,
        agencyType: agencyClass.agencyType,
        jurisdictionLevel: agencyClass.jurisdictionLevel,
        stateCode: "NE",
        website: NEBRASKA_URL,
      },
      title,
      description: category || null,
      solicitationType: type || "State solicitation",
      procurementMechanism: "Nebraska DAS public solicitation",
      status: "open",
      issueDate,
      dueAt,
      stateCode: "NE",
      sourceUrl: absolute(NEBRASKA_URL, href),
      rawPayload: {
        platform: "Nebraska DAS Materiel public bid board",
        posted: posted || null,
        description: title,
        category: category || null,
        opening: opening || null,
        type: type || null,
        buyer: buyer || null,
        solicitationNumber: externalId,
        agency: agencyName,
        updated: updated || null,
        sourcePage: NEBRASKA_URL,
      },
    });
  });

  return [...new Map(records.map(record => [record.externalId, record])).values()];
}

interface LouisianaDepartmentLink {
  name: string;
  url: string;
  count: number;
}

function parseLouisianaDepartmentLinks(html: string): LouisianaDepartmentLink[] {
  const $ = load(html);
  const seen = new Set<string>();
  const links: LouisianaDepartmentLink[] = [];

  $('a[href*="dspBid.cfm"]').each((_, anchor) => {
    const href = $(anchor).attr("href");
    if (!href || !/search=department/i.test(href)) return;
    const name = text($(anchor).text()).replace(/^\+\s*/, "");
    if (!name) return;
    const parentText = text($(anchor).parent().text());
    const count = Number(parentText.match(/\((\d+)\)/)?.[1] || 0);
    const url = absolute(LOUISIANA_DEPARTMENTS_URL, href);
    if (seen.has(url) || count <= 0) return;
    seen.add(url);
    links.push({ name, url, count });
  });

  return links;
}

function parseLouisianaBidPage(html: string, pageUrl: string, departmentName: string): SledOpportunityRecord[] {
  const $ = load(html);
  const records: SledOpportunityRecord[] = [];

  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 3) return;
    const first = $(cells[0]);
    const firstText = text(first.text());
    const issuedText = text($(cells[1]).text());
    const openingText = text($(cells[2]).text());
    if (!firstText || /bid number/i.test(firstText)) return;

    const links = first.find("a").toArray().map(anchor => ({
      label: text($(anchor).text()),
      url: absolute(pageUrl, $(anchor).attr("href")),
    })).filter(link => link.label);

    const originalLink = links.find(link => !/addendum|attachment/i.test(link.label));
    const originalMatch = firstText.match(/Original:\s*([^\s]+)/i);
    const headingMatch = firstText.match(/^([^\s]+)\s+(.+?)(?=Original:|Attachments:|Addendum\s*\d|$)/i);
    const externalId = text(originalMatch?.[1] || originalLink?.label || headingMatch?.[1] || "").replace(/^#/, "");
    const title = text(headingMatch?.[2] || firstText.split(/Original:/i)[0].replace(externalId, ""));
    if (!externalId || !title) return;

    const dueAt = parseUsDate(openingText, "central");
    if (dueAt && new Date(dueAt).getTime() < Date.now()) return;
    const issueDate = parseUsDate(issuedText, "central");
    const agencyClass = classifyAgency(departmentName);
    const addenda = links.filter(link => /addendum/i.test(link.label));
    const attachments = links.filter(link => /attachment/i.test(link.label));

    records.push({
      externalId,
      agency: {
        key: `louisiana:${departmentName}`,
        name: departmentName,
        agencyType: agencyClass.agencyType,
        jurisdictionLevel: agencyClass.jurisdictionLevel,
        stateCode: "LA",
        website: pageUrl,
      },
      title,
      solicitationType: /\bRFP\b|request for proposal/i.test(title) ? "RFP"
        : /\bRFQ\b|request for quotation/i.test(title) ? "RFQ"
        : /\bRFI\b|request for information/i.test(title) ? "RFI"
        : /\bIFB\b|invitation for bid/i.test(title) ? "IFB"
        : "State solicitation",
      procurementMechanism: "Louisiana LaPAC public solicitation",
      status: "open",
      issueDate,
      dueAt,
      stateCode: "LA",
      sourceUrl: originalLink?.url || pageUrl,
      rawPayload: {
        platform: "Louisiana Procurement and Contract Network (LaPAC)",
        department: departmentName,
        bidNumber: externalId,
        description: title,
        dateIssued: issuedText || null,
        bidOpenDate: openingText || null,
        documents: links,
        addenda,
        attachments,
        sourcePage: pageUrl,
      },
    });
  });

  return records;
}

async function fetchNebraska() {
  return parseNebraska((await fetchHtml(NEBRASKA_URL)).html);
}

async function fetchLouisiana() {
  const directory = await fetchHtml(LOUISIANA_DEPARTMENTS_URL);
  const departments = parseLouisianaDepartmentLinks(directory.html);
  if (!departments.length) throw new Error("No non-empty Louisiana LaPAC departments were found");

  const results: SledOpportunityRecord[] = [];
  const batchSize = 8;
  for (let i = 0; i < departments.length; i += batchSize) {
    const batch = departments.slice(i, i + batchSize);
    const pages = await Promise.all(batch.map(async department => {
      const page = await fetchHtml(department.url);
      return parseLouisianaBidPage(page.html, department.url, department.name);
    }));
    results.push(...pages.flat());
  }

  return [...new Map(results.map(record => [record.externalId, record])).values()];
}

async function syncOne(
  stateCode: string,
  source: SledSourceConfig,
  fetcher: () => Promise<SledOpportunityRecord[]>,
  bootstrap: boolean,
): Promise<DirectStateBoardResult> {
  try {
    const records = await fetcher();
    if (!records.length) throw new Error(`No current ${source.jurisdiction} solicitations were parsed`);
    const persisted = await persistSledOpportunities(source, records, {
      mode: bootstrap ? "direct_state_board_bootstrap" : "direct_state_board_refresh",
      recordChanges: !bootstrap,
    });
    return {
      stateCode,
      sourceName: source.sourceName,
      ok: true,
      rowsFound: records.length,
      ...persisted,
      pageLimited: false,
    };
  } catch (error) {
    return {
      stateCode,
      sourceName: source.sourceName,
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

export async function syncDirectStateBoards(bootstrap = false) {
  return Promise.all([
    syncOne("NE", NEBRASKA_SOURCE, fetchNebraska, bootstrap),
    syncOne("LA", LOUISIANA_SOURCE, fetchLouisiana, bootstrap),
  ]);
}
