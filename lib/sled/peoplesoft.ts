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

function text(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseDate(value: string) {
  const normalized = value
    .replace(/\bat\b/i, " ")
    .replace(/\bCDT\b/g, "GMT-0500")
    .replace(/\bCST\b/g, "GMT-0600")
    .replace(/\bCT\b/g, "GMT-0500")
    .replace(/(\d{1,2}:\d{2})(am|pm)\b/i, "$1 $2");
  const parsed = new Date(normalized);
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
  const $ = load(html);
  const body = $("body").text().replace(/\r/g, "");
  const chunks = body.split(/REFERENCE NUMBER:\s*/i).slice(1);
  const records: SledOpportunityRecord[] = [];

  for (const chunk of chunks) {
    const referenceNumber = text(chunk.match(/^([^\n]+)/)?.[1] || "");
    if (!referenceNumber) continue;
    const agency = text(chunk.match(/Purchasing Agency:\s*([^\n]+)/i)?.[1] || "State of Minnesota");
    const solicitationNumber = text(chunk.match(/Solicitation Number:\s*([^\n]+)/i)?.[1] || "");
    const version = text(chunk.match(/Solicitation Event Version:\s*([^\n]+)/i)?.[1] || "");
    const title = text(chunk.match(/Title:\s*([^\n]+)/i)?.[1] || "");
    const dueText = text(chunk.match(/Response to this solicitation is due no later than:\s*([^\n]+)/i)?.[1] || "");
    const postedText = text(chunk.match(/Date This Solicitation Was Posted:\s*([^\n]+)/i)?.[1] || "");
    const categories = text(chunk.match(/Category Codes:\s*([^\n]+)/i)?.[1] || "");
    const description = text(chunk.match(/Description of Work:\s*([\s\S]*?)(?:Date This Solicitation Was Posted:|Category Codes:|$)/i)?.[1] || "");
    if (!title || !dueText) continue;

    const dueAt = parseDate(dueText);
    if (dueAt && new Date(dueAt).getTime() < Date.now()) continue;
    const issueDate = postedText ? parseDate(postedText) : null;
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
