import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const NEBRASKA_URL = "https://das.nebraska.gov/materiel/bid-opportunities.html";

const SOURCE: SledSourceConfig = {
  adapterKey: "nebraska_das_ne",
  sourceName: "Nebraska DAS Current Bid Opportunities",
  baseUrl: NEBRASKA_URL,
  jurisdiction: "Nebraska",
  sourceType: "website",
};

export interface NebraskaSyncResult {
  stateCode: "NE";
  sourceName: string;
  ok: boolean;
  rowsFound: number;
  stored: number;
  newRecords: number;
  changedRecords: number;
  pageLimited: false;
  error?: string;
}

function text(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function absolute(base: string, href?: string) {
  if (!href || href.startsWith("javascript:")) return base;
  try { return new URL(href, base).toString(); } catch { return base; }
}

function parseDate(value: string, endOfDay = false) {
  const match = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const [, m, d, y] = match;
  const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
  const hour = endOfDay ? 23 : 12;
  return new Date(Date.UTC(year, Number(m) - 1, Number(d), hour + 5, endOfDay ? 59 : 0, endOfDay ? 59 : 0)).toISOString();
}

function classifyAgency(name: string) {
  const n = name.toLowerCase();
  if (/school|education/.test(n)) return { agencyType: "k12", jurisdictionLevel: "state" };
  if (/university|college/.test(n)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/county/.test(n)) return { agencyType: "county", jurisdictionLevel: "local" };
  if (/city|town|village|municipal/.test(n)) return { agencyType: "municipality", jurisdictionLevel: "local" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

async function fetchRecords(): Promise<SledOpportunityRecord[]> {
  const response = await fetch(NEBRASKA_URL, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Nebraska DAS returned ${response.status}`);
  const $ = load(await response.text());
  let table = $("h3, h4").filter((_, node) => /current bid opportunities/i.test(text($(node).text()))).first().nextAll("table").first();
  if (!table.length) table = $("table").filter((_, node) => /solicitation number/i.test(text($(node).find("tr").first().text()))).first();
  const records: SledOpportunityRecord[] = [];

  table.find("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 8) return;
    const cell = (i: number) => text($(cells[i]).text());
    const posted = cell(0);
    const title = cell(1);
    const category = cell(2);
    const opening = cell(3);
    const type = cell(4);
    const buyer = cell(5);
    const externalId = cell(6);
    const agencyName = cell(7);
    if (!externalId || !title || !agencyName || /solicitation number/i.test(externalId)) return;
    const dueAt = parseDate(opening, true);
    if (dueAt && new Date(dueAt).getTime() < Date.now()) return;
    const agencyClass = classifyAgency(agencyName);
    const href = $(cells[1]).find("a").first().attr("href") || $(cells[6]).find("a").first().attr("href");

    records.push({
      externalId,
      agency: {
        key: `nebraska:${agencyName}`,
        name: agencyName,
        agencyType: agencyClass.agencyType,
        jurisdictionLevel: agencyClass.jurisdictionLevel,
        stateCode: "NE",
        website: NEBRASKA_URL,
      },
      title,
      description: category || null,
      solicitationType: type || "State solicitation",
      procurementMechanism: "Nebraska DAS public solicitation",
      status: "open",
      issueDate: parseDate(posted),
      dueAt,
      stateCode: "NE",
      sourceUrl: absolute(NEBRASKA_URL, href),
      rawPayload: {
        platform: "Nebraska DAS Materiel public bid board",
        posted: posted || null,
        description: title,
        category: category || null,
        opening: opening || null,
        type: type || null,
        buyer: buyer || null,
        solicitationNumber: externalId,
        agency: agencyName,
        sourcePage: NEBRASKA_URL,
      },
    });
  });

  return [...new Map(records.map(record => [record.externalId, record])).values()];
}

export async function syncNebraskaBoard(bootstrap = false): Promise<NebraskaSyncResult> {
  try {
    const records = await fetchRecords();
    if (!records.length) throw new Error("No current Nebraska solicitations were parsed");
    const persisted = await persistSledOpportunities(SOURCE, records, {
      mode: bootstrap ? "nebraska_bootstrap" : "nebraska_refresh",
      recordChanges: !bootstrap,
    });
    return { stateCode: "NE", sourceName: SOURCE.sourceName, ok: true, rowsFound: records.length, ...persisted, pageLimited: false };
  } catch (error) {
    return {
      stateCode: "NE",
      sourceName: SOURCE.sourceName,
      ok: false,
      rowsFound: 0,
      stored: 0,
      newRecords: 0,
      changedRecords: 0,
      pageLimited: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
