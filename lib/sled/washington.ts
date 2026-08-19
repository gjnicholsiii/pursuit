import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const WEBS_URL = "https://pr-webs-vendor.des.wa.gov/BidCalendar.aspx";

const SOURCE: SledSourceConfig = {
  adapterKey: "webs_wa",
  sourceName: "Washington Electronic Business Solution (WEBS) Bid Opportunities",
  baseUrl: WEBS_URL,
  jurisdiction: "Washington",
  sourceType: "portal",
};

export interface WashingtonSyncResult {
  stateCode: "WA";
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  stored: number;
  newRecords: number;
  changedRecords: number;
  closedRecords?: number;
  pageLimited: false;
  error?: string;
}

function compact(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseDate(value: string, endOfDay = false) {
  const match = compact(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;
  const [, mm, dd, yy] = match;
  const year = Number(yy) < 100 ? 2000 + Number(yy) : Number(yy);
  const hour = endOfDay ? 23 : 12;
  return new Date(Date.UTC(year, Number(mm) - 1, Number(dd), hour + 7, endOfDay ? 59 : 0, endOfDay ? 59 : 0)).toISOString();
}

function classifyAgency(name: string) {
  const n = name.toLowerCase();
  if (/school|school district|public instruction/.test(n)) return { agencyType: "k12", jurisdictionLevel: "state" };
  if (/university|college|community college/.test(n)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/county/.test(n)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/city|town|municipal/.test(n)) return { agencyType: "municipality", jurisdictionLevel: "local" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

function absolute(href?: string) {
  if (!href || href.startsWith("javascript:")) return WEBS_URL;
  try { return new URL(href, WEBS_URL).toString(); } catch { return WEBS_URL; }
}

async function fetchRecords(): Promise<SledOpportunityRecord[]> {
  const response = await fetch(WEBS_URL, {
    cache: "no-store",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
  });
  if (!response.ok) throw new Error(`Washington WEBS returned ${response.status}`);
  const html = await response.text();
  const $ = load(html);
  const records: SledOpportunityRecord[] = [];

  $("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 3) return;
    const first = compact($(cells[0]).text());
    const middle = compact($(cells[1]).text());
    const last = compact($(cells[cells.length - 1]).text());
    if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(first)) return;

    const firstDates = first.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/g) || [];
    const closeDateText = firstDates[0] || "";
    const amendmentDateText = firstDates[1] || "";

    const refMatch = middle.match(/Ref#:\s*([^\n]+?)(?=\s+(?:see specifications|Includes an Inclusion Plan|Pre-Bid Conference|Deadline for Submitting Questions|Additional Data|$))/i)
      || middle.match(/Ref#:\s*([^\r\n]+)/i);
    const externalId = compact(refMatch?.[1] || "");
    if (!externalId) return;

    let title = middle.split(/Ref#:/i)[0].trim();
    if (!title) title = externalId;
    const description = middle
      .replace(title, "")
      .replace(/Ref#:\s*[^\s]+/i, "")
      .replace(/Includes an Inclusion Plan:\s*[YN]/i, "")
      .trim();

    const dueAt = parseDate(closeDateText, true);
    if (dueAt && new Date(dueAt).getTime() < Date.now() - 6 * 60 * 60 * 1000) return;

    const agencyName = last || "State of Washington";
    const agencyClass = classifyAgency(agencyName);
    const detailHref = $(cells[1]).find("a[href]").toArray().map(a => $(a).attr("href")).find(Boolean);

    records.push({
      externalId,
      agency: {
        key: `washington:${agencyName}`,
        name: agencyName,
        agencyType: agencyClass.agencyType,
        jurisdictionLevel: agencyClass.jurisdictionLevel,
        stateCode: "WA",
        website: WEBS_URL,
      },
      title,
      description: description || null,
      solicitationType: /RFP/i.test(externalId) ? "RFP" : /RFQ/i.test(externalId) ? "RFQ" : /RFI/i.test(externalId) ? "RFI" : /IFB|ITB/i.test(externalId) ? "Bid" : "State solicitation",
      procurementMechanism: "Washington WEBS public solicitation",
      status: "open",
      issueDate: amendmentDateText ? parseDate(amendmentDateText) : null,
      dueAt,
      stateCode: "WA",
      sourceUrl: absolute(detailHref),
      rawPayload: {
        platform: "Washington Electronic Business Solution (WEBS)",
        solicitationNumber: externalId,
        closeDate: closeDateText || null,
        amendmentDate: amendmentDateText || null,
        contact: last || null,
        listingText: middle,
        sourcePage: WEBS_URL,
      },
    });
  });

  const unique = [...new Map(records.map(record => [record.externalId, record])).values()];
  if (!unique.length) throw new Error("No current Washington WEBS solicitations were parsed");
  return unique;
}

export async function syncWashingtonWebs(): Promise<WashingtonSyncResult> {
  try {
    const records = await fetchRecords();
    const persisted = await persistSledOpportunities(SOURCE, records, {
      mode: "washington_webs_refresh",
      recordChanges: true,
      closeMissing: true,
    });
    return { stateCode: "WA", sourceName: SOURCE.sourceName, ok: true, rowsFound: records.length, ...persisted, pageLimited: false };
  } catch (error) {
    return {
      stateCode: "WA",
      sourceName: SOURCE.sourceName,
      ok: false,
      rowsFound: 0,
      stored: 0,
      newRecords: 0,
      changedRecords: 0,
      closedRecords: 0,
      pageLimited: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
