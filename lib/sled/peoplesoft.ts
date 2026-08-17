import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const MN_GS_URL = "https://osp.admin.mn.gov/GS-auto";
const MN_PT_URL = "https://osp.admin.mn.gov/PT-auto";

interface PublicPeopleSoftResult {
  stateCode: string;
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  stored?: number;
  newRecords?: number;
  changedRecords?: number;
  pageLimited: boolean;
  error?: string;
  sample?: Array<{ externalId: string; agency: string; title: string; dueAt: string | null }>;
}

const MINNESOTA_LABELS = [
  "REFERENCE NUMBER:",
  "Purchasing Agency:",
  "Solicitation Number:",
  "Solicitation Event Version:",
  "Title:",
  "Contract Available To:",
  "Contract Available to:",
  "Response to this solicitation is due no later than:",
  "Ship to Information:",
  "Description of Work:",
  "Date This Solicitation Was Posted:",
  "Category Codes:",
];

function text(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeMinnesotaBody(html: string) {
  const $ = load(html);
  let body = $("body").text().replace(/\r/g, "");

  for (const label of MINNESOTA_LABELS) {
    body = body.replace(new RegExp(`\\s*${escapeRegExp(label)}\\s*`, "gi"), `\n${label} `);
  }

  return body.replace(/\n{2,}/g, "\n").trim();
}

function field(chunk: string, label: string) {
  const match = chunk.match(new RegExp(`${escapeRegExp(label)}\\s*([^\\n]*)`, "i"));
  return text(match?.[1] || "");
}

function parseCentralDate(value: string) {
  const match = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:at)?\s*(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  const meridiem = match[6]?.toLowerCase();

  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
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
    const offset = observedAsUtc - utcMillis;
    utcMillis = desiredAsUtc - offset;
  }

  const parsed = new Date(utcMillis);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function classifyAgency(name: string) {
  const n = name.toLowerCase();
  if (/school district|public schools|board of education|k-12/.test(n)) return { agencyType: "k12", jurisdictionLevel: "local" };
  if (/university|college|higher education/.test(n)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/county/.test(n)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/city of|town of|village of|municipal/.test(n)) return { agencyType: "municipality", jurisdictionLevel: "local" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
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

function parseMinnesotaPage(html: string, sourceUrl: string, channel: "goods_services" | "professional_technical"): SledOpportunityRecord[] {
  const body = normalizeMinnesotaBody(html);
  const chunks = body.split(/(?:^|\n)REFERENCE NUMBER:\s*/i).slice(1);
  const records: SledOpportunityRecord[] = [];

  for (const chunk of chunks) {
    const referenceNumber = text(chunk.match(/^([^\n]+)/)?.[1] || "");
    if (!referenceNumber) continue;

    const agency = field(chunk, "Purchasing Agency:") || "State of Minnesota";
    const solicitationNumber = field(chunk, "Solicitation Number:");
    const version = field(chunk, "Solicitation Event Version:");
    const title = field(chunk, "Title:");
    const dueText = field(chunk, "Response to this solicitation is due no later than:");
    const postedText = field(chunk, "Date This Solicitation Was Posted:");
    const categories = field(chunk, "Category Codes:");
    const description = text(
      chunk.match(/Description of Work:\s*([\s\S]*?)(?:\nDate This Solicitation Was Posted:|\nCategory Codes:|$)/i)?.[1] || "",
    );

    if (!title || !dueText) continue;

    const dueAt = parseCentralDate(dueText);
    if (dueAt && new Date(dueAt).getTime() < Date.now()) continue;
    const issueDate = postedText ? parseCentralDate(postedText) : null;
    const externalId = solicitationNumber || `MN-${referenceNumber}`;
    const agencyClass = classifyAgency(agency);
    const type = /request for proposal|\brfp\b/i.test(description) ? "RFP"
      : /request for bid|\brfb\b/i.test(description) ? "RFB"
      : /single source/i.test(description) ? "Single Source Notice"
      : channel === "professional_technical" ? "Professional/Technical Solicitation" : "Goods/Services Solicitation";

    records.push({
      externalId,
      agency: {
        key: `minnesota:${agency}`,
        name: agency,
        agencyType: agencyClass.agencyType,
        jurisdictionLevel: agencyClass.jurisdictionLevel,
        stateCode: "MN",
        website: sourceUrl,
      },
      title,
      description: description || null,
      solicitationType: type,
      procurementMechanism: "Minnesota SWIFT public solicitation posting",
      status: "open",
      issueDate,
      dueAt,
      stateCode: "MN",
      sourceUrl,
      rawPayload: {
        platform: "SWIFT / PeopleSoft",
        state: "Minnesota",
        referenceNumber,
        solicitationNumber: solicitationNumber || null,
        solicitationEventVersion: version || null,
        title,
        agency,
        responseDue: dueText,
        postedAt: postedText || null,
        categoryCodes: categories ? categories.split(/[,\s]+/).filter(Boolean) : [],
        channel,
        sourcePage: sourceUrl,
      },
    });
  }

  return records;
}

async function fetchMinnesota() {
  const htmlPages: Array<{ html: string; url: string; channel: "goods_services" | "professional_technical" }> = [];
  htmlPages.push({ html: await fetchHtml(MN_GS_URL), url: MN_GS_URL, channel: "goods_services" });

  try {
    htmlPages.push({ html: await fetchHtml(MN_PT_URL), url: MN_PT_URL, channel: "professional_technical" });
  } catch {
    // Goods/services is the verified public source. Professional/technical is additive when available.
  }

  const records = htmlPages.flatMap(page => parseMinnesotaPage(page.html, page.url, page.channel));
  return [...new Map(records.map(record => [record.externalId, record])).values()];
}

export async function probePublicPeopleSoft(): Promise<PublicPeopleSoftResult[]> {
  try {
    const records = await fetchMinnesota();
    return [{
      stateCode: "MN",
      sourceName: "Minnesota SWIFT Public Postings",
      ok: records.length > 0,
      rowsFound: records.length,
      pageLimited: false,
      sample: records.slice(0, 3).map(record => ({ externalId: record.externalId, agency: record.agency.name, title: record.title, dueAt: record.dueAt || null })),
      ...(records.length ? {} : { error: "No current solicitation rows parsed" }),
    }];
  } catch (error) {
    return [{ stateCode: "MN", sourceName: "Minnesota SWIFT Public Postings", ok: false, rowsFound: 0, pageLimited: false, error: error instanceof Error ? error.message : String(error) }];
  }
}

export async function syncPublicPeopleSoft() {
  const results: PublicPeopleSoftResult[] = [];
  try {
    const records = await fetchMinnesota();
    if (!records.length) throw new Error("No current solicitation rows parsed");
    const source: SledSourceConfig = {
      adapterKey: "peoplesoft_mn",
      sourceName: "Minnesota SWIFT Public Postings",
      baseUrl: MN_GS_URL,
      jurisdiction: "Minnesota",
      sourceType: "website",
    };
    const persisted = await persistSledOpportunities(source, records, { mode: "peoplesoft_public", recordChanges: true });
    results.push({ stateCode: "MN", sourceName: "Minnesota SWIFT Public Postings", ok: true, rowsFound: records.length, pageLimited: false, ...persisted });
  } catch (error) {
    results.push({ stateCode: "MN", sourceName: "Minnesota SWIFT Public Postings", ok: false, rowsFound: 0, pageLimited: false, error: error instanceof Error ? error.message : String(error) });
  }
  return results;
}
