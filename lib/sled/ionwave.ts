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
  { key: "plano_isd_tx", agencyName: "Plano Independent School District", baseUrl: "https://pisd.ionwave.net", stateCode: "TX", city: "Plano", county: "Collin" },
  { key: "lewisville_isd_tx", agencyName: "Lewisville Independent School District", baseUrl: "https://lisd.ionwave.net", stateCode: "TX", city: "Lewisville", county: "Denton" },
  { key: "houston_isd_tx", agencyName: "Houston Independent School District", baseUrl: "https://houstonisd.ionwave.net", stateCode: "TX", city: "Houston", county: "Harris" },
];

export const IONWAVE_SOURCE: SledSourceConfig = {
  adapterKey: "ionwave_k12",
  sourceName: "Euna Procurement by IonWave - K-12",
  baseUrl: "https://ionwave.net",
  jurisdiction: "United States",
  sourceType: "portal",
};

function clean(value: string) { return value.replace(/\s+/g, " ").trim(); }
function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

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

function parseBidIds(html: string) {
  const marker = html.indexOf('"_clientKeyValues"');
  const scope = marker >= 0 ? html.slice(marker, marker + 12000) : html;
  const ids = new Map<number, string>();
  for (const match of scope.matchAll(/"(\d+)"\s*:\s*\{\s*"BidID"\s*:\s*"(\d+)"\s*\}/g)) ids.set(Number(match[1]), match[2]);
  return ids;
}

async function fetchIonWaveList(portal: IonWavePortal) {
  const listUrl = `${portal.baseUrl}/SourcingEvents.aspx?SourceType=1`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(listUrl, {
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Pursuit/1.0 procurement-opportunity indexer" },
      cache: "no-store",
    });
    if (response.ok) return { response, listUrl };
    if (response.status !== 429 || attempt === 2) throw new Error(`IonWave ${portal.key} returned HTTP ${response.status}`);
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    await sleep(Math.min(Math.max(retryAfter * 1000, 2000 * (attempt + 1)), 8000));
  }
  throw new Error(`IonWave ${portal.key} retry budget exhausted`);
}

export async function discoverIonWavePortal(portal: IonWavePortal): Promise<SledOpportunityRecord[]> {
  const { response, listUrl } = await fetchIonWaveList(portal);
  const html = await response.text();
  const bidIds = parseBidIds(html);
  const $ = cheerio.load(html);
  const opportunities: SledOpportunityRecord[] = [];

  $("tr").each((_, row) => {
    const cells = $(row).find("td").map((__, cell) => clean($(cell).text())).get();
    if (cells.length < 6) return;
    const values = cells.filter((value, index) => index > 0 || value.length > 0);
    if (values.length < 6) return;
    const [bidNumber, title, bidType, organization, issueDateText, closeDateText] = values.slice(-6);
    if (!bidNumber || !title || /bid number/i.test(bidNumber)) return;

    const rowId = $(row).attr("id") || "";
    const rowIndexMatch = rowId.match(/rgBidList_ctl00__(\d+)$/);
    const rowIndex = rowIndexMatch ? Number(rowIndexMatch[1]) : null;
    const bidId = rowIndex === null ? null : bidIds.get(rowIndex) || null;
    const sourceUrl = bidId ? `${portal.baseUrl}/PublicDetail.aspx?bidID=${encodeURIComponent(bidId)}&SourceType=1` : listUrl;
    const dueAt = parseIonWaveTimestamp(closeDateText);
    const issueDate = parseIonWaveDate(issueDateText);

    opportunities.push({
      externalId: `${portal.key}:${bidNumber}`,
      agency: {
        key: portal.key, name: portal.agencyName, agencyType: "k12", jurisdictionLevel: "local",
        stateCode: portal.stateCode, city: portal.city || null, county: portal.county || null, website: portal.baseUrl,
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
        portalFamily: "ionwave", portalKey: portal.key, bidId, rowIndex,
        bidNumber, title, bidType, organization, issueDateText, closeDateText, sourceUrl,
      },
    });
  });

  return [...new Map(opportunities.map(item => [item.externalId, item])).values()];
}

export async function discoverIonWaveK12(portals: IonWavePortal[] = IONWAVE_K12_PORTALS) {
  const opportunities: SledOpportunityRecord[] = [];
  const diagnostics: Array<Record<string, unknown>> = [];
  for (const portal of portals) {
    try {
      const portalOpportunities = await discoverIonWavePortal(portal);
      opportunities.push(...portalOpportunities);
      diagnostics.push({ portal: portal.key, ok: true, records: portalOpportunities.length });
    } catch (error) {
      diagnostics.push({ portal: portal.key, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    await sleep(750);
  }
  return { opportunities, diagnostics };
}
