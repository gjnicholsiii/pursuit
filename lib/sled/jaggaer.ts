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
  { stateCode: "NM", stateName: "New Mexico", customerOrg: "StateOfNewMexico", sourceName: "New Mexico eProNM Public Events", agencyName: "State of New Mexico" },
];

export interface JaggaerProbeResult {
  stateCode: string;
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  pageCount: number | null;
  resultCount: number | null;
  complete: boolean;
  sample: Array<{ externalId: string; title: string; dueAt: string | null; sourceUrl: string }>;
  error?: string;
}

function text(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function cookieHeader(setCookie: string | null) {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=[^;,]+=)/)
    .map(part => part.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
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

function parseJaggaerEvents(html: string, config: JaggaerStateConfig, complete: boolean): SledOpportunityRecord[] {
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
        pageLimited: !complete,
      },
    });
  });

  return records;
}

function parseCounts(html: string) {
  const $ = load(html);
  const summary = text($(".readOnlyPageOf").first().text()) || text($("body").text());
  const resultMatch = summary.match(/\d+\s*-\s*\d+\s*of\s*(\d+)\s*Results/i);
  const resultCount = resultMatch ? Number(resultMatch[1]) : null;
  const pageSize = Number($('input[name="PageSize"]').first().attr("value") || 0) || null;
  return {
    pageCount: resultCount && pageSize ? Math.ceil(resultCount / pageSize) : null,
    resultCount,
    pageSize,
  };
}

function activeFormParams(html: string) {
  const $ = load(html);
  const form = $('form[name="ActiveForm"]').first();
  if (!form.length) throw new Error("JAGGAER ActiveForm was not found");
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
    const selected = select.find("option:selected").attr("value") || select.find("option").first().attr("value") || "";
    params.set(name, selected);
  });

  return { action: form.attr("action") || "", params };
}

async function fetchJaggaer(config: JaggaerStateConfig) {
  const url = publicUrl(config);
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
  const cookie = cookieHeader(initial.headers.get("set-cookie"));
  const initialCounts = parseCounts(initialHtml);
  const initialRecords = parseJaggaerEvents(initialHtml, config, initialCounts.resultCount === null || initialCounts.resultCount <= initialRecordsLength(initialHtml));

  if (!initialCounts.resultCount || initialCounts.resultCount <= initialRecords.length) {
    return {
      records: parseJaggaerEvents(initialHtml, config, true),
      pageCount: 1,
      resultCount: initialCounts.resultCount ?? initialRecords.length,
      complete: true,
    };
  }

  if (initialCounts.resultCount > 200) {
    return {
      records: initialRecords,
      pageCount: initialCounts.pageCount ?? Math.ceil(initialCounts.resultCount / 20),
      resultCount: initialCounts.resultCount,
      complete: false,
    };
  }

  const built = activeFormParams(initialHtml);
  built.params.set("PageSize", "200");
  built.params.set("PageNum", "1");
  built.params.set("ESSearchAfter", "");
  const postUrl = new URL(built.action || initial.url, initial.url).toString();
  const response = await fetch(postUrl, {
    method: "POST",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "content-type": "application/x-www-form-urlencoded",
      referer: initial.url,
      ...(cookie ? { cookie } : {}),
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    body: built.params,
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${config.sourceName} full-result request returned ${response.status}`);

  const html = await response.text();
  const counts = parseCounts(html);
  const records = parseJaggaerEvents(html, config, true);
  const expected = counts.resultCount ?? initialCounts.resultCount;
  const complete = Boolean(expected !== null && records.length === expected);
  return {
    records: complete ? records : parseJaggaerEvents(html, config, false),
    pageCount: counts.pageCount ?? 1,
    resultCount: expected,
    complete,
  };
}

function initialRecordsLength(html: string) {
  const $ = load(html);
  return new Set(
    $('a[href*="app01.jaggaer.com/apps/Router/ViewSourcingEvent"]').toArray().map(anchor => text($(anchor).text())).filter(Boolean),
  ).size;
}

export async function probeJaggaerStates(): Promise<JaggaerProbeResult[]> {
  return Promise.all(JAGGAER_STATES.map(async config => {
    try {
      const { records, pageCount, resultCount, complete } = await fetchJaggaer(config);
      return {
        stateCode: config.stateCode,
        sourceName: config.sourceName,
        ok: records.length > 0,
        rowsFound: records.length,
        pageCount,
        resultCount,
        complete,
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
        complete: false,
        sample: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));
}

export async function syncJaggaerFullSweeps() {
  const results = [];
  for (const config of JAGGAER_STATES) {
    try {
      const { records, pageCount, resultCount, complete } = await fetchJaggaer(config);
      if (!records.length) throw new Error("No open JAGGAER events parsed");
      const source: SledSourceConfig = {
        adapterKey: `jaggaer_${config.stateCode.toLowerCase()}`,
        sourceName: config.sourceName,
        baseUrl: publicUrl(config),
        jurisdiction: config.stateName,
        sourceType: "portal",
      };
      const persisted = await persistSledOpportunities(source, records, {
        mode: complete ? "jaggaer_full_sweep" : "jaggaer_partial_sweep",
        recordChanges: true,
        closeMissing: complete,
      });
      results.push({ stateCode: config.stateCode, ok: true, rowsFound: records.length, pageCount, resultCount, complete, ...persisted, pageLimited: !complete });
    } catch (error) {
      results.push({ stateCode: config.stateCode, ok: false, rowsFound: 0, stored: 0, newRecords: 0, changedRecords: 0, closedRecords: 0, pageCount: null, resultCount: null, complete: false, pageLimited: true, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
