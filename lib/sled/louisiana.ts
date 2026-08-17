import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const DEPARTMENTS_URL = "https://wwwcfprd.doa.louisiana.gov/OSP/LaPAC/deptbids.cfm";

const SOURCE: SledSourceConfig = {
  adapterKey: "louisiana_lapac_la",
  sourceName: "Louisiana LaPAC Open Solicitations",
  baseUrl: "https://wwwcfprd.doa.louisiana.gov/OSP/LaPAC/pubMain.cfm",
  jurisdiction: "Louisiana",
  sourceType: "website",
};

export interface LouisianaSyncResult {
  stateCode: "LA";
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  stored: number;
  newRecords: number;
  changedRecords: number;
  pageLimited: false;
  error?: string;
}

interface DepartmentLink {
  name: string;
  url: string;
  count: number;
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

function parseCentral(value: string) {
  const cleaned = text(value);
  if (!cleaned) return null;
  const normalized = cleaned
    .replace(/\bCT\b/g, "GMT-0500")
    .replace(/\bCST\b/g, "GMT-0600")
    .replace(/\bCDT\b/g, "GMT-0500");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function classifyAgency(name: string) {
  const n = name.toLowerCase();
  if (/school board|school district|schools|education/.test(n)) return { agencyType: "k12", jurisdictionLevel: "local" };
  if (/university|college/.test(n)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/parish/.test(n)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/city of|town of|municipal/.test(n)) return { agencyType: "municipality", jurisdictionLevel: "local" };
  if (/authority|commission|district|port|transit/.test(n)) return { agencyType: "authority", jurisdictionLevel: "local" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

function parseDepartmentLinks(html: string): DepartmentLink[] {
  const $ = load(html);
  const links: DepartmentLink[] = [];
  const seen = new Set<string>();

  $('a[href*="dspBid.cfm"]').each((_, anchor) => {
    const href = $(anchor).attr("href");
    if (!href || !/search=department/i.test(href)) return;
    const rawLabel = text($(anchor).text());
    const count = Number(rawLabel.match(/\((\d+)\)\s*$/)?.[1] || text($(anchor).parent().text()).match(/\((\d+)\)/)?.[1] || 0);
    if (count <= 0) return;
    const name = rawLabel
      .replace(/^\+{1,2}\s*/, "")
      .replace(/^\+-\s*/, "")
      .replace(/\s*-\s*\(\d+\)\s*$/, "")
      .trim();
    if (!name) return;
    const url = absolute(DEPARTMENTS_URL, href);
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ name, url, count });
  });

  return links;
}

function solicitationType(title: string) {
  if (/\bRFP\b|request for proposal/i.test(title)) return "RFP";
  if (/\bRFQ\b|request for quotation/i.test(title)) return "RFQ";
  if (/\bRFI\b|request for information/i.test(title)) return "RFI";
  if (/\bIFB\b|invitation for bid/i.test(title)) return "IFB";
  return "State/local solicitation";
}

function parseBidPage(html: string, pageUrl: string, departmentName: string): SledOpportunityRecord[] {
  const $ = load(html);
  const records: SledOpportunityRecord[] = [];
  let current: SledOpportunityRecord | null = null;

  let table = $("table").filter((_, node) => {
    const header = text($(node).find("tr").first().text());
    return /Bid Number/i.test(header) && /Description/i.test(header) && /Bid Open Date/i.test(header);
  }).first();
  if (!table.length) table = $("table").first();

  table.find("tr").each((_, row) => {
    const cells = $(row).find("td");
    const rowText = text($(row).text());

    if (/\bAddendum\s*(?:No\.?\s*)?\d+/i.test(rowText) && current) {
      const addenda = $(row).find("a").toArray().map(anchor => ({
        label: text($(anchor).text()),
        url: absolute(pageUrl, $(anchor).attr("href")),
      })).filter(item => item.label && item.url !== pageUrl);
      if (addenda.length) {
        const raw = current.rawPayload;
        const existing = Array.isArray(raw.addenda) ? raw.addenda as Array<Record<string, unknown>> : [];
        raw.addenda = [...existing, ...addenda];
        const documents = Array.isArray(raw.documents) ? raw.documents as Array<Record<string, unknown>> : [];
        raw.documents = [...documents, ...addenda];
      }
      return;
    }

    if (cells.length < 5) return;
    const bidCell = $(cells[0]);
    const descriptionCell = $(cells[1]);
    const bidText = text(bidCell.text());
    const descriptionText = text(descriptionCell.text());
    const issuedText = text($(cells[2]).text());
    const openingText = text($(cells[3]).text());
    if (!bidText || /bid number/i.test(bidText) || !descriptionText) return;
    if (/bid cancelled/i.test(rowText)) return;

    const externalId = text(bidText.split(/\s+/)[0]).replace(/^#/, "");
    if (!externalId || !/[A-Z0-9]/i.test(externalId)) return;
    const title = text(descriptionText.split(/Original:|Attachments:|Addendum\s*(?:No\.?\s*)?\d+/i)[0]);
    if (!title) return;

    const dueAt = parseCentral(openingText);
    if (!dueAt || new Date(dueAt).getTime() < Date.now()) return;
    const issueDate = parseCentral(issuedText);

    const links = $(row).find("a").toArray().map(anchor => ({
      label: text($(anchor).text()),
      url: absolute(pageUrl, $(anchor).attr("href")),
    })).filter(item => item.label && item.url !== pageUrl);
    const originalLink = links.find(item => item.label.replace(/\s/g, "") === externalId.replace(/\s/g, ""))
      || links.find(item => !/attachment|addendum/i.test(item.label));
    const attachments = links.filter(item => /attachment/i.test(item.label));
    const agencyClass = classifyAgency(departmentName);

    current = {
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
      description: descriptionText || null,
      solicitationType: solicitationType(title),
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
        description: descriptionText,
        dateIssued: issuedText || null,
        bidOpenDate: openingText || null,
        documents: links,
        attachments,
        addenda: [],
        sourcePage: pageUrl,
      },
    };
    records.push(current);
  });

  return records;
}

async function fetchLouisiana() {
  const directory = await fetchHtml(DEPARTMENTS_URL);
  const departments = parseDepartmentLinks(directory);
  if (!departments.length) throw new Error("No non-empty Louisiana LaPAC departments were found");

  const records: SledOpportunityRecord[] = [];
  const batchSize = 6;
  for (let i = 0; i < departments.length; i += batchSize) {
    const batch = departments.slice(i, i + batchSize);
    const pages = await Promise.all(batch.map(async department => {
      const html = await fetchHtml(department.url);
      return parseBidPage(html, department.url, department.name);
    }));
    records.push(...pages.flat());
  }

  return [...new Map(records.map(record => [record.externalId, record])).values()];
}

export async function syncLouisianaLapac(bootstrap = false): Promise<LouisianaSyncResult> {
  try {
    const records = await fetchLouisiana();
    if (!records.length) throw new Error("No currently open Louisiana LaPAC solicitations were parsed");
    const persisted = await persistSledOpportunities(SOURCE, records, {
      mode: bootstrap ? "louisiana_lapac_bootstrap" : "louisiana_lapac_refresh",
      recordChanges: !bootstrap,
    });
    return {
      stateCode: "LA",
      sourceName: SOURCE.sourceName,
      ok: true,
      rowsFound: records.length,
      ...persisted,
      pageLimited: false,
    };
  } catch (error) {
    return {
      stateCode: "LA",
      sourceName: SOURCE.sourceName,
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
