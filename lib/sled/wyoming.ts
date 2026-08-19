import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const SHEET_ID = "1d0aQlrK99Gn43_uAV044-PZ7DZ2MTbxnjgLIsyz85mw";
const SHEET_CSV = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
const SOURCE_PAGE = "https://ai.wyo.gov/divisions/general-services/purchasing/non-construction-bids";

const SOURCE: SledSourceConfig = {
  adapterKey: "wyoming_ai_released_bids_wy",
  sourceName: "Wyoming A&I FY27 Released Bids",
  baseUrl: SOURCE_PAGE,
  jurisdiction: "Wyoming",
  sourceType: "document_index",
};

export interface WyomingSyncResult {
  stateCode: "WY";
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

function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ""; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function text(v: unknown) { return String(v ?? "").replace(/\s+/g, " ").trim(); }

function parseDate(value: string, endOfDay = false) {
  const m = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const hourUtc = endOfDay ? 5 : 18;
  return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), hourUtc, endOfDay ? 59 : 0, endOfDay ? 59 : 0)).toISOString();
}

function classifyAgency(name: string) {
  const n = name.toLowerCase();
  if (/education|school/.test(n)) return { agencyType: "k12", jurisdictionLevel: "state" };
  if (/university|college/.test(n)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

async function fetchRecords(): Promise<SledOpportunityRecord[]> {
  const response = await fetch(SHEET_CSV, { cache: "no-store", headers: { accept: "text/csv,*/*", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
  if (!response.ok) throw new Error(`Wyoming released-bids sheet returned ${response.status}`);
  const rows = parseCsv(await response.text());
  if (rows.length < 2) throw new Error("Wyoming released-bids sheet returned no data rows");
  const header = rows[0].map(text);
  const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const bidI = idx("Bid Number");
  const agencyI = idx("AGENCY NAME");
  const descI = idx("DESCRIPTION");
  const sentI = idx("DATE BID SENT OUT");
  const openI = idx("OPENING DATE");
  const awardedI = idx("AWARDED TO (Vendor)");
  const contactI = idx("AGENGY CONTACT EMAIL");
  if ([bidI, agencyI, descI, openI].some(i => i < 0)) throw new Error("Wyoming released-bids sheet headers changed");

  const now = Date.now();
  const records: SledOpportunityRecord[] = [];
  for (const row of rows.slice(1)) {
    const externalId = text(row[bidI]);
    const agencyName = text(row[agencyI]);
    const title = text(row[descI]);
    const openingRaw = text(row[openI]);
    if (!externalId || !agencyName || !title || !openingRaw) continue;
    const dueAt = parseDate(openingRaw, true);
    if (!dueAt || new Date(dueAt).getTime() < now) continue;
    const awarded = awardedI >= 0 ? text(row[awardedI]) : "";
    if (awarded && !/^pending$/i.test(awarded)) continue;
    const agencyClass = classifyAgency(agencyName);
    records.push({
      externalId,
      agency: {
        key: `wyoming:${agencyName}`,
        name: agencyName,
        agencyType: agencyClass.agencyType,
        jurisdictionLevel: agencyClass.jurisdictionLevel,
        stateCode: "WY",
        website: SOURCE_PAGE,
      },
      title,
      description: null,
      solicitationType: "State solicitation",
      procurementMechanism: "Wyoming A&I formal bid process",
      status: "open",
      issueDate: sentI >= 0 ? parseDate(text(row[sentI])) : null,
      dueAt,
      stateCode: "WY",
      sourceUrl: SOURCE_PAGE,
      rawPayload: {
        platform: "Wyoming A&I released-bids public sheet / Public Purchase downstream",
        bidNumber: externalId,
        agency: agencyName,
        description: title,
        dateBidSentOut: sentI >= 0 ? text(row[sentI]) || null : null,
        openingDate: openingRaw,
        awardedTo: awarded || null,
        agencyContactEmail: contactI >= 0 ? text(row[contactI]) || null : null,
        sourceSheet: SHEET_CSV,
      },
    });
  }
  return [...new Map(records.map(record => [record.externalId, record])).values()];
}

export async function syncWyomingReleasedBids(): Promise<WyomingSyncResult> {
  try {
    const records = await fetchRecords();
    if (!records.length) throw new Error("No currently open Wyoming A&I released bids were parsed");
    const persisted = await persistSledOpportunities(SOURCE, records, {
      mode: "wyoming_ai_released_bids_refresh",
      recordChanges: true,
      closeMissing: true,
    });
    return { stateCode: "WY", sourceName: SOURCE.sourceName, ok: true, rowsFound: records.length, ...persisted, pageLimited: false };
  } catch (error) {
    return { stateCode: "WY", sourceName: SOURCE.sourceName, ok: false, rowsFound: 0, stored: 0, newRecords: 0, changedRecords: 0, closedRecords: 0, pageLimited: false, error: error instanceof Error ? error.message : String(error) };
  }
}
