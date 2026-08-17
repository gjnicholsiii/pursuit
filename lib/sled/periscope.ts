import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

interface PeriscopeStateConfig {
  stateCode: string;
  stateName: string;
  baseUrl: string;
  sourceName: string;
}

const PERISCOPE_STATES: PeriscopeStateConfig[] = [
  { stateCode: "IL", stateName: "Illinois", baseUrl: "https://www.bidbuy.illinois.gov/bso/", sourceName: "Illinois BidBuy" },
  { stateCode: "MA", stateName: "Massachusetts", baseUrl: "https://www.commbuys.com/bso/", sourceName: "Massachusetts COMMBUYS" },
  { stateCode: "NV", stateName: "Nevada", baseUrl: "https://nevadaepro.com/bso/", sourceName: "NevadaEPro" },
  { stateCode: "NJ", stateName: "New Jersey", baseUrl: "https://www.njstart.gov/bso/", sourceName: "New Jersey NJSTART" },
  { stateCode: "OR", stateName: "Oregon", baseUrl: "https://oregonbuys.gov/bso/", sourceName: "OregonBuys" },
];

export interface PeriscopeProbeResult {
  stateCode: string;
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  sample: Array<{ externalId: string; agency: string; title: string; dueAt: string | null }>;
  error?: string;
}

function text(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function absolute(base: string, href?: string) {
  if (!href || href.startsWith("javascript:")) return base;
  try { return new URL(href, base).toString(); } catch { return base; }
}

function isoDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function classifyAgency(name: string) {
  const normalized = name.toLowerCase();
  if (/school district|public schools|school department|board of education|elementary|secondary education/.test(normalized)) {
    return { agencyType: "k12", jurisdictionLevel: "local" };
  }
  if (/university|college|community college|higher education/.test(normalized)) {
    return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  }
  if (/county/.test(normalized)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/city of|town of|village of|borough of|municipal/.test(normalized)) {
    return { agencyType: "municipality", jurisdictionLevel: "local" };
  }
  if (/authority|commission|district/.test(normalized)) return { agencyType: "authority", jurisdictionLevel: "local" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

function parsePeriscopeOpenBids(html: string, config: PeriscopeStateConfig): SledOpportunityRecord[] {
  const $ = load(html);
  const records: SledOpportunityRecord[] = [];
  let targetTable = $("table").filter((_, table) => {
    const header = text($(table).find("tr").first().text());
    return /Bid Solicitation #/i.test(header) && /Description/i.test(header) && /Bid Opening Date/i.test(header);
  }).first();

  if (!targetTable.length) {
    targetTable = $("table").filter((_, table) => /Bid search results/i.test(text($(table).parent().text()))).first();
  }

  targetTable.find("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 8) return;
    const cell = (index: number) => text($(cells[index]).text());
    const externalId = cell(1) || cell(0);
    const agencyName = cell(2);
    const buyer = cell(5);
    const title = cell(6);
    const dueText = cell(7);
    const statusText = cells.length > 10 ? cell(10) : "";
    const alternateId = cells.length > 11 ? cell(11) : "";
    if (!externalId || !agencyName || !title || !dueText || /Bid Solicitation #/i.test(externalId)) return;

    const dueAt = isoDate(dueText);
    if (dueAt && new Date(dueAt).getTime() < Date.now()) return;
    const href = $(cells[0]).find("a").first().attr("href");
    const agencyClass = classifyAgency(agencyName);

    records.push({
      externalId,
      agency: {
        key: `periscope:${config.stateCode}:${agencyName}`,
        name: agencyName,
        agencyType: agencyClass.agencyType,
        jurisdictionLevel: agencyClass.jurisdictionLevel,
        stateCode: config.stateCode,
        website: config.baseUrl,
      },
      title,
      solicitationType: "Bid solicitation",
      procurementMechanism: "Periscope S2G public solicitation",
      status: "open",
      dueAt,
      stateCode: config.stateCode,
      sourceUrl: absolute(config.baseUrl, href),
      rawPayload: {
        platform: "Periscope S2G",
        state: config.stateName,
        solicitationNumber: externalId,
        organization: agencyName,
        buyer: buyer || null,
        description: title,
        bidOpeningDate: dueText,
        status: statusText || null,
        alternateId: alternateId || null,
        sourcePage: new URL("view/search/external/advancedSearchBid.xhtml?openBids=true", config.baseUrl).toString(),
        pageLimited: true,
      },
    });
  });

  return [...new Map(records.map(record => [record.externalId, record])).values()];
}

async function fetchOpenBids(config: PeriscopeStateConfig) {
  const url = new URL("view/search/external/advancedSearchBid.xhtml?openBids=true", config.baseUrl).toString();
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${config.sourceName} returned ${response.status}`);
  return parsePeriscopeOpenBids(await response.text(), config);
}

export async function probePeriscopeStates(): Promise<PeriscopeProbeResult[]> {
  return Promise.all(PERISCOPE_STATES.map(async config => {
    try {
      const records = await fetchOpenBids(config);
      return {
        stateCode: config.stateCode,
        sourceName: config.sourceName,
        ok: records.length > 0,
        rowsFound: records.length,
        sample: records.slice(0, 3).map(record => ({
          externalId: record.externalId,
          agency: record.agency.name,
          title: record.title,
          dueAt: record.dueAt || null,
        })),
        ...(records.length ? {} : { error: "No open bid rows parsed" }),
      };
    } catch (error) {
      return {
        stateCode: config.stateCode,
        sourceName: config.sourceName,
        ok: false,
        rowsFound: 0,
        sample: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));
}

export async function syncPeriscopeFirstPages() {
  const results = [];
  for (const config of PERISCOPE_STATES) {
    try {
      const records = await fetchOpenBids(config);
      if (!records.length) throw new Error("No open bid rows parsed");
      const source: SledSourceConfig = {
        adapterKey: `periscope_${config.stateCode.toLowerCase()}`,
        sourceName: config.sourceName,
        baseUrl: config.baseUrl,
        jurisdiction: config.stateName,
        sourceType: "portal",
      };
      const persisted = await persistSledOpportunities(source, records, {
        mode: "periscope_first_page",
        recordChanges: true,
      });
      results.push({ stateCode: config.stateCode, ok: true, rowsFound: records.length, ...persisted, pageLimited: true });
    } catch (error) {
      results.push({ stateCode: config.stateCode, ok: false, rowsFound: 0, stored: 0, newRecords: 0, changedRecords: 0, pageLimited: true, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
