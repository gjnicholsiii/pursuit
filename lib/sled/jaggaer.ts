import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

interface JaggaerStateConfig {
  stateCode: string;
  stateName: string;
  customerOrg: string;
  sourceName: string;
  agencyName: string;
}

const JAGGAER_STATES: JaggaerStateConfig[] = [
  { stateCode: "GA", stateName: "Georgia", customerOrg: "Georgia", sourceName: "Georgia GA@WORK Marketplace Public Events", agencyName: "State of Georgia" },
  { stateCode: "IA", stateName: "Iowa", customerOrg: "DASIowa", sourceName: "Iowa IMPACS", agencyName: "State of Iowa" },
  { stateCode: "MT", stateName: "Montana", customerOrg: "StateOfMontana", sourceName: "Montana eMACS", agencyName: "State of Montana" },
  { stateCode: "UT", stateName: "Utah", customerOrg: "StateOfUtah", sourceName: "Utah Public Procurement Place", agencyName: "State of Utah" },
  { stateCode: "PA", stateName: "Pennsylvania", customerOrg: "CommonwealthPA", sourceName: "Pennsylvania JAGGAER Public Events", agencyName: "Commonwealth of Pennsylvania" },
];

export interface JaggaerProbeResult {
  stateCode: string;
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  pageCount: number | null;
  resultCount: number | null;
  sample: Array<{ externalId: string; title: string; dueAt: string | null; sourceUrl: string }>;
  error?: string;
}

function text(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function publicUrl(config: JaggaerStateConfig) {
  return `https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=${encodeURIComponent(config.customerOrg)}`;
}

function parseDate(value: string) {
  const normalized = value
    .replace(/\bCDT\b/g, "GMT-0500")
    .replace(/\bCST\b/g, "GMT-0600")
    .replace(/\bMDT\b/g, "GMT-0600")
    .replace(/\bMST\b/g, "GMT-0700")
    .replace(/\bEDT\b/g, "GMT-0400")
    .replace(/\bEST\b/g, "GMT-0500")
    .replace(/\bPDT\b/g, "GMT-0700")
    .replace(/\bPST\b/g, "GMT-0800");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function classifyTitle(title: string) {
  const normalized = title.toLowerCase();
  if (/university|college|campus|\bmsu\b|higher education/.test(normalized)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/school|k-12|charter/.test(normalized)) return { agencyType: "k12", jurisdictionLevel: "state" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

function parseJaggaerEvents(html: string, config: JaggaerStateConfig): SledOpportunityRecord[] {
  const $ = load(html);
  const base = publicUrl(config);
  const records: SledOpportunityRecord[] = [];
  const seen = new Set<string>();

  $('a[href*="app01.jaggaer.com/apps/Router/ViewSourcingEvent"]').each((_, anchor) => {
    const title = text($(anchor).text());
    if (!title) return;

    const container = $(anchor).closest("td");
    if (!container.length) return;
    const block = text(container.text());

    const numberMatch = block.match(/\bNumber\s*([^\s]+)(?:\s+Cancellation Posting)?/i);
    const typeMatch = block.match(/\bType\s*(.+?)\s*Number/i);
    const openMatch = block.match(/\bOpen\s*(.+?)\s*Close/i);
    const closeMatch = block.match(/\bClose\s*(.+?)\s*Type/i);
    const contacts = [...block.matchAll(/\bContact\s+(.+?)\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi)].map(match => ({ name: text(match[1]), email: match[2] }));
    const externalId = text(numberMatch?.[1] || "");
    if (!externalId || seen.has(externalId)) return;
    seen.add(externalId);

    const pdfHref = container.find('a[href*="solutions-selectsite-documents.s3.amazonaws.com"]').first().attr("href") || "";
    const pdfKey = pdfHref.match(/\/Sourcingevent\/([^?]+)/i)?.[1] || null;
    const dueAt = closeMatch ? parseDate(text(closeMatch[1])) : null;
    const issueDate = openMatch ? parseDate(text(openMatch[1])) : null;
    const type = text(typeMatch?.[1] || "Jaggaer solicitation");
    const titleClass = classifyTitle(title);

    const titleIndex = block.indexOf(title);
    const openIndex = block.search(/\bOpen\s*\d/i);
    const description = titleIndex >= 0 && openIndex > titleIndex
      ? text(block.slice(titleIndex + title.length, openIndex)) || null
      : null;

    records.push({
      externalId,
      agency: {
        key: `jaggaer:${config.stateCode}:${config.customerOrg}`,
        name: config.agencyName,
        agencyType: titleClass.agencyType,
        jurisdictionLevel: titleClass.jurisdictionLevel,
        stateCode: config.stateCode,
        website: base,
      },
      title,
      description,
      solicitationType: type,
      procurementMechanism: "JAGGAER public solicitation",
      status: "open",
      issueDate,
      dueAt,
      stateCode: config.stateCode,
      sourceUrl: base,
      rawPayload: {
        platform: "JAGGAER ONE",
        state: config.stateName,
        customerOrg: config.customerOrg,
        eventNumber: externalId,
        eventType: type,
        title,
        openDate: openMatch ? text(openMatch[1]) : null,
        closeDate: closeMatch ? text(closeMatch[1]) : null,
        contacts,
        pdfDocumentKey: pdfKey,
        pdfAvailable: Boolean(pdfHref),
        sourcePage: base,
        pageLimited: true,
      },
    });
  });

  return records;
}

function parseCounts(html: string) {
  const plain = text(load(html)("body").text());
  const resultMatch = plain.match(/\d+\s*-\s*\d+\s*of\s*(\d+)\s*Results/i);
  const resultCount = resultMatch ? Number(resultMatch[1]) : null;
  return {
    pageCount: resultCount ? Math.ceil(resultCount / 20) : null,
    resultCount,
  };
}

async function fetchJaggaer(config: JaggaerStateConfig) {
  const url = publicUrl(config);
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${config.sourceName} returned ${response.status}`);
  const html = await response.text();
  const records = parseJaggaerEvents(html, config);
  const counts = parseCounts(html);
  return {
    records,
    pageCount: counts.pageCount ?? (records.length ? 1 : null),
    resultCount: counts.resultCount ?? (records.length || null),
  };
}

export async function probeJaggaerStates(): Promise<JaggaerProbeResult[]> {
  return Promise.all(JAGGAER_STATES.map(async config => {
    try {
      const { records, pageCount, resultCount } = await fetchJaggaer(config);
      return {
        stateCode: config.stateCode,
        sourceName: config.sourceName,
        ok: records.length > 0,
        rowsFound: records.length,
        pageCount,
        resultCount,
        sample: records.slice(0, 3).map(record => ({
          externalId: record.externalId,
          title: record.title,
          dueAt: record.dueAt || null,
          sourceUrl: record.sourceUrl,
        })),
        ...(records.length ? {} : { error: "No open JAGGAER events parsed" }),
      };
    } catch (error) {
      return {
        stateCode: config.stateCode,
        sourceName: config.sourceName,
        ok: false,
        rowsFound: 0,
        pageCount: null,
        resultCount: null,
        sample: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));
}

export async function syncJaggaerFirstPages() {
  const results = [];
  for (const config of JAGGAER_STATES) {
    try {
      const { records, pageCount, resultCount } = await fetchJaggaer(config);
      if (!records.length) throw new Error("No open JAGGAER events parsed");
      const source: SledSourceConfig = {
        adapterKey: `jaggaer_${config.stateCode.toLowerCase()}`,
        sourceName: config.sourceName,
        baseUrl: publicUrl(config),
        jurisdiction: config.stateName,
        sourceType: "portal",
      };
      const persisted = await persistSledOpportunities(source, records, {
        mode: "jaggaer_first_page",
        recordChanges: true,
      });
      results.push({ stateCode: config.stateCode, ok: true, rowsFound: records.length, pageCount, resultCount, ...persisted, pageLimited: (pageCount || 1) > 1 });
    } catch (error) {
      results.push({ stateCode: config.stateCode, ok: false, rowsFound: 0, stored: 0, newRecords: 0, changedRecords: 0, pageCount: null, resultCount: null, pageLimited: true, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
