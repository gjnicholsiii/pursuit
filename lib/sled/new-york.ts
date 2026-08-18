import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const NYSCR_BASE = "https://www.nyscr.ny.gov/Ads/Search";
const PAGE_SIZE = 25;
const MAX_PAGES = 60;
const BATCH_SIZE = 6;

const NEW_YORK_SOURCE: SledSourceConfig = {
  adapterKey: "nyscr_ny",
  sourceName: "New York State Contract Reporter",
  baseUrl: NYSCR_BASE,
  jurisdiction: "New York",
  sourceType: "portal",
};

export interface NewYorkSyncResult {
  stateCode: "NY";
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  totalReported: number | null;
  pagesFetched: number;
  complete: boolean;
  stored: number;
  newRecords: number;
  changedRecords: number;
  closedRecords: number;
  error?: string;
}

function text(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function searchUrl(skip: number) {
  const url = new URL(NYSCR_BASE);
  url.searchParams.set("DateFilter", "All");
  url.searchParams.set("DivisionId", "");
  url.searchParams.set("GovernmentId", "");
  url.searchParams.set("Keyword", "");
  url.searchParams.set("Skip", String(skip));
  url.searchParams.set("Sort", "-DateIssued");
  url.searchParams.set("Status", "Open");
  url.searchParams.set("SubcontractId", "");
  url.searchParams.set("Top", String(PAGE_SIZE));
  url.searchParams.set("UseBookmarks", "");
  url.searchParams.set("UseNotifications", "");
  url.searchParams.set("UseProfile", "");
  return url.toString();
}

function publicRecordUrl(externalId: string) {
  const url = new URL(NYSCR_BASE);
  url.searchParams.set("DateFilter", "All");
  url.searchParams.set("Keyword", externalId);
  url.searchParams.set("Sort", "-DateIssued");
  url.searchParams.set("Status", "Open");
  url.searchParams.set("Top", "25");
  return url.toString();
}

function easternDateOnly(value: string, endOfDay = false) {
  const match = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const hour = endOfDay ? 23 : 0;
  const minute = endOfDay ? 59 : 0;
  const second = endOfDay ? 59 : 0;
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  let utcMillis = desiredAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(utcMillis)).map(part => [part.type, part.value]),
    );
    const observedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    utcMillis = desiredAsUtc - (observedAsUtc - utcMillis);
  }

  return new Date(utcMillis).toISOString();
}

function classifyAgency(name: string) {
  const n = name.toLowerCase();
  if (/school district|public schools|board of education|\bschools\b|\bacademy\b/.test(n)) {
    return { agencyType: "k12", jurisdictionLevel: "local" };
  }
  if (/state university|\bsuny\b|city university|\bcuny\b|university|college/.test(n)) {
    return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  }
  if (/\bcounty\b/.test(n)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/\btown of\b|\bcity of\b|\bvillage of\b|municipal/.test(n)) {
    return { agencyType: "municipality", jurisdictionLevel: "local" };
  }
  if (/authority|commission|district|corporation|public benefit/.test(n)) {
    return { agencyType: "authority", jurisdictionLevel: "state" };
  }
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

function inferType(title: string, adType: string) {
  const combined = `${title} ${adType}`.toLowerCase();
  if (/request for information|\brfei\b|\brfi\b/.test(combined)) return "RFI";
  if (/request for qualifications|\brfq\b/.test(combined)) return "RFQ";
  if (/request for proposal|\brfp\b/.test(combined)) return "RFP";
  if (/invitation (?:for|to) bid|\bifb\b|\bitb\b/.test(combined)) return "IFB";
  if (/sole source|single source/.test(combined)) return "Sole Source Notice";
  return adType || "Public procurement notice";
}

function titleFromCard(card: ReturnType<ReturnType<typeof load>>) {
  const titled = card.find('[title^="Full Title:"]').first();
  const attribute = text(titled.attr("title"));
  if (attribute) return text(attribute.replace(/^Full Title:\s*/i, ""));
  return text(card.children(".d-flex").first().children("div").last().text());
}

function fieldsFromCard(card: ReturnType<ReturnType<typeof load>>) {
  const fields = new Map<string, string>();
  card.find(".flex-fill.pt-1.pt-lg-0 > .d-flex").each((_, row) => {
    const children = card.find(row).children("div");
    if (children.length < 2) return;
    const label = text(card.find(children[0]).text()).replace(/\s+/g, " ");
    const value = text(children.slice(1).text());
    if (label && value) fields.set(label, value);
  });
  return fields;
}

function parsePage(html: string): { records: SledOpportunityRecord[]; totalReported: number | null; cardsSeen: number } {
  const $ = load(html);
  const body = text($("body").text());
  const totalMatch = body.match(/All Open Opportunities:\s*([\d,]+)/i);
  const totalReported = totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : null;
  const records: SledOpportunityRecord[] = [];
  let cardsSeen = 0;

  $(".flex-fill.min-w-0.border-lg-dark-subtle").each((_, node) => {
    const card = $(node);
    const fields = new Map<string, string>();
    card.find(".flex-fill.pt-1.pt-lg-0 > .d-flex").each((__, row) => {
      const children = $(row).children("div");
      if (children.length < 2) return;
      const label = text($(children[0]).text());
      const value = text(children.slice(1).text());
      if (label && value) fields.set(label, value);
    });

    const externalId = fields.get("CR#:") || "";
    const agencyName = fields.get("Agency:") || "";
    const companyName = fields.get("Company:") || "";
    const titleNode = card.find('[title^="Full Title:"]').first();
    const titleAttribute = text(titleNode.attr("title"));
    const title = titleAttribute
      ? text(titleAttribute.replace(/^Full Title:\s*/i, ""))
      : text(card.children(".d-flex").first().children("div").last().text());

    if (!externalId || !title) return;
    cardsSeen += 1;

    // Contractor advertisements are private subcontracting notices, not direct public-buyer opportunities.
    if (!agencyName && companyName) return;
    if (!agencyName) return;

    const dueText = fields.get("Due date:") || fields.get("Ad end date:") || "";
    const dueAt = dueText ? easternDateOnly(dueText, true) : null;
    if (dueAt && new Date(dueAt).getTime() < Date.now()) return;
    const issueText = fields.get("Issue date:") || "";
    const issueDate = issueText ? easternDateOnly(issueText) : null;
    const category = fields.get("Category:") || "";
    const note = fields.get("Note:") || "";
    const adType = fields.get("Ad type:") || "";
    const location = fields.get("Location:") || "";
    const division = fields.get("Division:") || "";
    const agencyClass = classifyAgency(agencyName);

    records.push({
      externalId,
      agency: {
        key: `nyscr:${agencyName}`,
        name: agencyName,
        agencyType: agencyClass.agencyType,
        jurisdictionLevel: agencyClass.jurisdictionLevel,
        stateCode: "NY",
        website: NYSCR_BASE,
      },
      title,
      description: [note, category ? `Category: ${category}` : ""].filter(Boolean).join("\n") || null,
      solicitationType: inferType(title, adType),
      procurementMechanism: "New York State Contract Reporter public opportunity",
      status: "open",
      issueDate,
      dueAt,
      stateCode: "NY",
      sourceUrl: publicRecordUrl(externalId),
      rawPayload: {
        platform: "New York State Contract Reporter",
        crNumber: externalId,
        agency: agencyName,
        division: division || null,
        title,
        note: note || null,
        issueDate: issueText || null,
        dueDate: dueText || null,
        location: location || null,
        category: category || null,
        adType: adType || null,
        sourcePage: publicRecordUrl(externalId),
      },
    });
  });

  return { records, totalReported, cardsSeen };
}

async function fetchPage(skip: number) {
  const url = searchUrl(skip);
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`NYS Contract Reporter page at skip ${skip} returned ${response.status}`);
  const html = await response.text();
  return { skip, ...parsePage(html) };
}

async function fetchCompleteSweep() {
  const first = await fetchPage(0);
  if (!first.totalReported && first.cardsSeen === 0) throw new Error("NYS Contract Reporter returned no open opportunity cards");

  const totalReported = first.totalReported ?? first.cardsSeen;
  const pageCount = Math.max(1, Math.ceil(totalReported / PAGE_SIZE));
  if (pageCount > MAX_PAGES) throw new Error(`NYS Contract Reporter requires ${pageCount} pages, above safety cap ${MAX_PAGES}`);

  const pages = [first];
  const remainingSkips = Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => (index + 1) * PAGE_SIZE);
  for (let index = 0; index < remainingSkips.length; index += BATCH_SIZE) {
    const batch = remainingSkips.slice(index, index + BATCH_SIZE);
    pages.push(...await Promise.all(batch.map(fetchPage)));
  }

  const records = [...new Map(pages.flatMap(page => page.records).map(record => [record.externalId, record])).values()];
  const cardsSeen = pages.reduce((sum, page) => sum + page.cardsSeen, 0);
  const complete = pages.length === pageCount && cardsSeen >= Math.min(totalReported, (pageCount - 1) * PAGE_SIZE + 1);
  return { records, totalReported, pageCount, pagesFetched: pages.length, cardsSeen, complete };
}

export async function syncNewYorkContractReporter(): Promise<NewYorkSyncResult> {
  try {
    const sweep = await fetchCompleteSweep();
    if (!sweep.complete) throw new Error(`NYS Contract Reporter sweep incomplete: ${sweep.pagesFetched}/${sweep.pageCount} pages`);
    if (!sweep.records.length) throw new Error("No direct public-buyer New York opportunities were parsed");

    const persisted = await persistSledOpportunities(NEW_YORK_SOURCE, sweep.records, {
      mode: "nyscr_full_sweep",
      recordChanges: true,
      closeMissing: true,
    });

    return {
      stateCode: "NY",
      sourceName: NEW_YORK_SOURCE.sourceName,
      ok: true,
      rowsFound: sweep.records.length,
      totalReported: sweep.totalReported,
      pagesFetched: sweep.pagesFetched,
      complete: true,
      ...persisted,
    };
  } catch (error) {
    return {
      stateCode: "NY",
      sourceName: NEW_YORK_SOURCE.sourceName,
      ok: false,
      rowsFound: 0,
      totalReported: null,
      pagesFetched: 0,
      complete: false,
      stored: 0,
      newRecords: 0,
      changedRecords: 0,
      closedRecords: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
