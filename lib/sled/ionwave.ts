import * as cheerio from "cheerio";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

export interface IonWavePortal {
  key: string;
  agencyName: string;
  baseUrl: string;
  stateCode: string;
  city?: string;
  county?: string;
}

export const IONWAVE_K12_PORTALS: IonWavePortal[] = [
  {
    key: "plano_isd_tx",
    agencyName: "Plano Independent School District",
    baseUrl: "https://pisd.ionwave.net",
    stateCode: "TX",
    city: "Plano",
    county: "Collin",
  },
  {
    key: "lewisville_isd_tx",
    agencyName: "Lewisville Independent School District",
    baseUrl: "https://lisd.ionwave.net",
    stateCode: "TX",
    city: "Lewisville",
    county: "Denton",
  },
  {
    key: "houston_isd_tx",
    agencyName: "Houston Independent School District",
    baseUrl: "https://houstonisd.ionwave.net",
    stateCode: "TX",
    city: "Houston",
    county: "Harris",
  },
];

export const IONWAVE_SOURCE: SledSourceConfig = {
  adapterKey: "ionwave_k12",
  sourceName: "Euna Procurement by IonWave - K-12",
  baseUrl: "https://ionwave.net",
  jurisdiction: "United States",
  sourceType: "portal",
};

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function inferSolicitationType(bidNumber: string, title: string) {
  const text = `${bidNumber} ${title}`.toUpperCase();
  if (/\bCSP\b/.test(text)) return "CSP";
  if (/\bRFQ\b/.test(text)) return "RFQ";
  if (/\bRFP\b/.test(text)) return "RFP";
  if (/\bIFB\b|\bITB\b|\bBID\b/.test(text)) return "IFB";
  if (/\bAPPLICATION\b/.test(text)) return "Application";
  return null;
}

function parseIonWaveTimestamp(value: string) {
  const text = clean(value).replace(/\s*\([A-Z]{2,4}\)\s*$/, "");
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!match) return null;
  const [, mm, dd, yyyy, rawHour, minute, second = "00", ampm] = match;
  let hour = Number(rawHour) % 12;
  if (ampm.toUpperCase() === "PM") hour += 12;
  const month = Number(mm);
  // IonWave portals in this initial K-12 registry are Central Time. Preserve the
  // source's exact clock time and use a conservative DST approximation; raw text
  // remains in rawPayload for audit/evidence.
  const offset = month >= 4 && month <= 10 ? "-05:00" : "-06:00";
  const iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${String(hour).padStart(2, "0")}:${minute}:${second}${offset}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseIonWaveDate(value: string) {
  const match = clean(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function absoluteUrl(baseUrl: string, href?: string) {
  if (!href) return `${baseUrl}/SourcingEvents.aspx?SourceType=1`;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return `${baseUrl}/SourcingEvents.aspx?SourceType=1`;
  }
}

export async function discoverIonWavePortal(portal: IonWavePortal): Promise<SledOpportunityRecord[]> {
  const listUrl = `${portal.baseUrl}/SourcingEvents.aspx?SourceType=1`;
  const response = await fetch(listUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Pursuit/1.0 procurement-opportunity indexer",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`IonWave ${portal.key} returned HTTP ${response.status}`);

  const html = await response.text();
  const $ = cheerio.load(html);
  const opportunities: SledOpportunityRecord[] = [];

  $("tr").each((_, row) => {
    const cells = $(row).find("td").map((__, cell) => clean($(cell).text())).get();
    if (cells.length < 6) return;

    // IonWave's public grid normally has a blank selector column followed by:
    // Bid Number, Bid Title, Bid Type, Organization, Issue Date, Close Date/Time.
    const values = cells.filter((value, index) => index > 0 || value.length > 0);
    if (values.length < 6) return;
    const [bidNumber, title, bidType, organization, issueDateText, closeDateText] = values.slice(-6);
    if (!bidNumber || !title || /bid number/i.test(bidNumber)) return;

    const anchor = $(row).find("a[href]").first();
    const href = anchor.attr("href");
    const sourceUrl = absoluteUrl(portal.baseUrl, href);
    const dueAt = parseIonWaveTimestamp(closeDateText);
    const issueDate = parseIonWaveDate(issueDateText);

    opportunities.push({
      externalId: `${portal.key}:${bidNumber}`,
      agency: {
        key: portal.key,
        name: portal.agencyName,
        agencyType: "k12",
        jurisdictionLevel: "local",
        stateCode: portal.stateCode,
        city: portal.city || null,
        county: portal.county || null,
        website: portal.baseUrl,
      },
      title,
      description: null,
      solicitationType: clean(bidType) || inferSolicitationType(bidNumber, title),
      procurementMechanism: "competitive solicitation",
      status: "open",
      issueDate,
      dueAt,
      prebidAt: null,
      estimatedValue: null,
      stateCode: portal.stateCode,
      city: portal.city || null,
      naicsCodes: [],
      setAside: null,
      sourceUrl,
      rawPayload: {
        portalFamily: "ionwave",
        portalKey: portal.key,
        bidNumber,
        title,
        bidType,
        organization,
        issueDateText,
        closeDateText,
        sourceUrl,
      },
    });
  });

  return [...new Map(opportunities.map(item => [item.externalId, item])).values()];
}

export async function discoverIonWaveK12(portals: IonWavePortal[] = IONWAVE_K12_PORTALS) {
  const results = await Promise.allSettled(portals.map(async portal => ({
    portal,
    opportunities: await discoverIonWavePortal(portal),
  })));

  const opportunities: SledOpportunityRecord[] = [];
  const diagnostics: Array<Record<string, unknown>> = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      opportunities.push(...result.value.opportunities);
      diagnostics.push({ portal: result.value.portal.key, ok: true, records: result.value.opportunities.length });
    } else {
      diagnostics.push({ ok: false, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
    }
  }

  return { opportunities, diagnostics };
}
