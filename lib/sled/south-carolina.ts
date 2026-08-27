import { createHash } from "crypto";
import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const SCBO_URL = "https://scbo.sc.gov/online-edition";

const SCBO_SOURCE: SledSourceConfig = {
  adapterKey: "south_carolina_scbo_sc",
  sourceName: "South Carolina Business Opportunities (SCBO)",
  baseUrl: SCBO_URL,
  jurisdiction: "South Carolina",
  sourceType: "website",
};

export interface SouthCarolinaSyncResult {
  stateCode: "SC";
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  categoriesFound: number;
  stored: number;
  newRecords: number;
  changedRecords: number;
  closedRecords?: number;
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

function parseEastern(value: string) {
  const cleaned = text(value).replace(/\s+-\s+/, " ");
  if (!cleaned) return null;
  const monthName = cleaned.match(/^([A-Za-z]+)/)?.[1]?.toLowerCase() || "";
  const monthIndex = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(monthName);
  const offset = monthIndex >= 2 && monthIndex <= 10 ? "GMT-0400" : "GMT-0500";
  const normalized = cleaned.replace(/(\d{1,2}:\d{2})(am|pm)\b/i, "$1 $2");
  const parsed = new Date(`${normalized} ${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseDateOnly(value: string) {
  const cleaned = text(value);
  if (!cleaned) return null;
  const parsed = new Date(`${cleaned} 12:00 PM GMT-0400`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function classifyAgency(name: string) {
  const n = name.toLowerCase();
  if (/school district|public schools|charter school|academy|k[- ]?12/.test(n)) return { agencyType: "k12", jurisdictionLevel: "local" };
  if (/university|college|technical college|higher education/.test(n)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/county/.test(n)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/city of|town of|village of|municipal/.test(n)) return { agencyType: "municipality", jurisdictionLevel: "local" };
  if (/airport|authority|commission|district|lottery/.test(n)) return { agencyType: "authority", jurisdictionLevel: "local" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

function findField(block: string, label: string, nextLabels: string[]) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lookahead = nextLabels.map(next => next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const regex = new RegExp(`${escapedLabel}\\s*([\\s\\S]*?)(?=\\s*(?:${lookahead})\\s*|$)`, "i");
  return text(block.match(regex)?.[1] || "");
}

function parseCategoryLinks(html: string) {
  const $ = load(html);
  const seen = new Set<string>();
  const links: Array<{ name: string; url: string }> = [];

  $('a[href*="online-edition?c="]').each((_, anchor) => {
    const label = text($(anchor).parent().text()) || text($(anchor).text());
    const count = Number(label.match(/(\d+)\s+ads?/i)?.[1] || 0);
    if (count <= 0) return;
    const url = absolute(SCBO_URL, $(anchor).attr("href"));
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ name: label.replace(/:\s*\d+\s+ads?.*$/i, ""), url });
  });

  return links;
}

function parseScboCategory(html: string, pageUrl: string, category: string): SledOpportunityRecord[] {
  const rawChunks = html.split(/Ad Title:\s*/i).slice(1);
  const records: SledOpportunityRecord[] = [];

  const labels = [
    "Purchasing Agent/Entity:",
    "Ad Publish Date:",
    "Solicitation #:",
    "Direct Inquiries To:",
    "Bid/Submittal Due Date:",
    "Buyer Phone#:",
    "Buyer Email:",
    "Description:",
    "Pre-Bid Information:",
    "Full Details / Download:",
    "Print Ad",
    "Ad Title:",
  ];

  for (const rawChunk of rawChunks) {
    const fragment = load(rawChunk);
    const chunk = fragment.root().text().replace(/\r/g, "");
    const title = text(chunk.split(/Purchasing Agent\/Entity:/i)[0]);
    const agencyName = findField(chunk, "Purchasing Agent/Entity:", labels.slice(1));
    const publishText = findField(chunk, "Ad Publish Date:", labels.slice(2));
    const solicitationNumber = findField(chunk, "Solicitation #:", labels.slice(3));
    const contactName = findField(chunk, "Direct Inquiries To:", labels.slice(4));
    const dueText = findField(chunk, "Bid/Submittal Due Date:", labels.slice(5));
    const phone = findField(chunk, "Buyer Phone#:", labels.slice(6));
    const email = findField(chunk, "Buyer Email:", labels.slice(7));
    const description = findField(chunk, "Description:", labels.slice(8));
    const preBid = findField(chunk, "Pre-Bid Information:", labels.slice(9));
    const detailMarkup = rawChunk.split(/Full Details\s*\/\s*Download:/i)[1]?.split(/Print Ad/i)[0] || "";
    const detail$ = load(detailMarkup);
    const detailHref = detail$('a[href]').first().attr("href");
    const fullDetailsUrl = detailHref && !detailHref.startsWith("javascript:") ? absolute(pageUrl, detailHref) : null;

    if (!title || !agencyName || !dueText) continue;
    const dueAt = parseEastern(dueText);
    if (!dueAt || new Date(dueAt).getTime() < Date.now()) continue;

    const normalizedNumber = solicitationNumber && !/^n\/?a$/i.test(solicitationNumber) ? solicitationNumber : "";
    const externalId = normalizedNumber || `SCBO-${createHash("sha256").update(`${agencyName}|${title}|${dueText}`).digest("hex").slice(0, 18)}`;
    const agencyClass = classifyAgency(agencyName);
    const titleUpper = title.toUpperCase();
    const solicitationType = /\bRFI\b/.test(titleUpper) ? "RFI"
      : /\bRFQ\b/.test(titleUpper) ? "RFQ"
      : /\bRFP\b/.test(titleUpper) ? "RFP"
      : /\bIFB\b|\bITB\b/.test(titleUpper) ? "IFB"
      : category || "Public solicitation";

    records.push({
      externalId,
      agency: {
        key: `south-carolina:${agencyName}`,
        name: agencyName,
        agencyType: agencyClass.agencyType,
        jurisdictionLevel: agencyClass.jurisdictionLevel,
        stateCode: "SC",
        website: pageUrl,
      },
      title,
      description: description || null,
      solicitationType,
      procurementMechanism: "South Carolina Business Opportunities public advertisement",
      status: "open",
      issueDate: parseDateOnly(publishText),
      dueAt,
      stateCode: "SC",
      sourceUrl: fullDetailsUrl || pageUrl,
      rawPayload: {
        platform: "South Carolina Business Opportunities (SCBO)",
        category,
        solicitationNumber: normalizedNumber || null,
        title,
        entity: agencyName,
        publishDate: publishText || null,
        responseDue: dueText,
        contactName: contactName || null,
        buyerPhone: phone || null,
        buyerEmail: email || null,
        description: description || null,
        preBidInformation: preBid || null,
        fullDetailsUrl,
        sourcePage: pageUrl,
      },
    });
  }

  return records;
}

async function fetchSouthCarolina() {
  const root = await fetchHtml(SCBO_URL);
  const categories = parseCategoryLinks(root.html);
  if (!categories.length) throw new Error("No active SCBO categories were found");

  const records: SledOpportunityRecord[] = [];
  const batchSize = 5;
  for (let i = 0; i < categories.length; i += batchSize) {
    const batch = categories.slice(i, i + batchSize);
    const pages = await Promise.all(batch.map(async item => {
      const page = await fetchHtml(item.url);
      return parseScboCategory(page.html, item.url, item.name);
    }));
    records.push(...pages.flat());
  }

  return {
    categoriesFound: categories.length,
    records: [...new Map(records.map(record => [record.externalId, record])).values()],
  };
}

export async function syncSouthCarolinaScbo(bootstrap = false): Promise<SouthCarolinaSyncResult> {
  try {
    const { categoriesFound, records } = await fetchSouthCarolina();
    if (!records.length) throw new Error("No current SCBO solicitations were parsed");
    const persisted = await persistSledOpportunities(SCBO_SOURCE, records, {
      mode: bootstrap ? "scbo_bootstrap" : "scbo_refresh",
      recordChanges: !bootstrap,
      closeMissing: true,
    });
    return {
      stateCode: "SC",
      sourceName: SCBO_SOURCE.sourceName,
      ok: true,
      rowsFound: records.length,
      categoriesFound,
      ...persisted,
      pageLimited: false,
    };
  } catch (error) {
    return {
      stateCode: "SC",
      sourceName: SCBO_SOURCE.sourceName,
      ok: false,
      rowsFound: 0,
      categoriesFound: 0,
      stored: 0,
      newRecords: 0,
      changedRecords: 0,
      closedRecords: 0,
      pageLimited: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
