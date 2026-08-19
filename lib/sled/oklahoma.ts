import { load } from "cheerio";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const BASE = "https://financials.ok.gov";
const PUBLIC_URL = `${BASE}/psc/SOKLFP1DS/SUPPLIER/ERP/c/SCP_PUBLIC_MENU_FL.SCP_PUB_BID_CMP_FL.GBL`;

function text(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function cookieHeader(values: string[]) {
  const jar = new Map<string, string>();
  for (const raw of values) {
    for (const part of raw.split(/,(?=[^;,]+=)/)) {
      const token = part.split(";")[0].trim();
      const eq = token.indexOf("=");
      if (eq > 0) jar.set(token.slice(0, eq), token.slice(eq + 1));
    }
  }
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}

function parseCentralDate(value: string) {
  const match = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)\s+(CST|CDT)/i);
  if (!match) return null;
  let hour = Number(match[4]);
  if (match[6].toUpperCase() === "PM" && hour < 12) hour += 12;
  if (match[6].toUpperCase() === "AM" && hour === 12) hour = 0;
  const offset = match[7].toUpperCase() === "CDT" ? "-05:00" : "-06:00";
  const iso = `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}T${String(hour).padStart(2, "0")}:${match[5]}:00${offset}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function classifyAgency(name: string) {
  const n = name.toLowerCase();
  if (/university|college|higher education|career and tech/.test(n)) return { agencyType: "higher_ed", jurisdictionLevel: "state" };
  if (/school|education/.test(n)) return { agencyType: "k12", jurisdictionLevel: "state" };
  return { agencyType: "state_agency", jurisdictionLevel: "state" };
}

async function fetchBoard() {
  const first = await fetch(PUBLIC_URL, {
    redirect: "manual",
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    cache: "no-store",
  });
  if (first.status !== 302 && !first.ok) throw new Error(`Oklahoma public bidding entry returned ${first.status}`);
  const location = first.headers.get("location");
  const cookies = cookieHeader([first.headers.get("set-cookie") || ""]);
  const response = await fetch(location ? new URL(location, BASE).toString() : PUBLIC_URL, {
    redirect: "follow",
    headers: { accept: "text/html,application/xhtml+xml", cookie: cookies, "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Oklahoma public bidding board returned ${response.status}`);
  const html = await response.text();
  if (!/Bidding Event Information|SCP_PUB_AUC_VW/i.test(html)) throw new Error("Oklahoma public bidding grid was not found");
  return html;
}

function parseBoard(html: string) {
  const $ = load(html);
  const rowCountText = text($("#win0divSCP_PUB_AUC_VWrowcnt\\$0").text());
  const expected = Number(rowCountText.match(/(\d+)\s+rows?/i)?.[1] || 0);
  const records: SledOpportunityRecord[] = [];
  const rowNodes = $('[id^="SCP_PUB_AUC_VW$0_row_"]').toArray();

  for (const row of rowNodes) {
    const id = $(row).attr("id") || "";
    const index = id.match(/_row_(\d+)$/)?.[1];
    if (index === undefined) continue;
    const title = text($(`#SCP_PUB_AUC_VW_AUC_NAME\\$${index}`).text());
    const externalId = text($(`#SCP_PUB_AUC_VW_AUC_ID\\$${index}`).text());
    const agency = text($(`#BUS_UNIT_AUC_VW_DESCR\\$${index}`).text()) || "State of Oklahoma";
    const eventFormat = text($(`#SCP_PUB_AUC_VW_AUC_FORMAT\\$${index}`).text());
    const eventType = text($(`#SCP_PUB_AUC_VW_AUC_TYPE\\$${index}`).text());
    const startText = text($(`#SCP_COSP_WK_FL_SCP_STRT_DATE_CHAR\\$${index}`).text());
    const endText = text($(`#SCP_COSP_WK_FL_SCP_END_DATE_CHAR\\$${index}`).text());
    if (!title || !externalId || !endText) continue;
    const dueAt = parseCentralDate(endText);
    if (dueAt && new Date(dueAt).getTime() < Date.now()) continue;
    const issueDate = parseCentralDate(startText);
    const agencyClass = classifyAgency(agency);
    records.push({
      externalId,
      agency: {
        key: `oklahoma:${agency}`,
        name: agency,
        agencyType: agencyClass.agencyType,
        jurisdictionLevel: agencyClass.jurisdictionLevel,
        stateCode: "OK",
        website: PUBLIC_URL,
      },
      title,
      description: null,
      solicitationType: eventType || "RFx",
      procurementMechanism: "Oklahoma PeopleSoft public bidding event",
      status: "open",
      issueDate,
      dueAt,
      stateCode: "OK",
      sourceUrl: PUBLIC_URL,
      rawPayload: {
        platform: "Oklahoma Financials / PeopleSoft",
        eventId: externalId,
        eventName: title,
        businessUnit: agency,
        eventFormat: eventFormat || null,
        eventType: eventType || null,
        startDate: startText || null,
        endDate: endText || null,
        sourcePage: PUBLIC_URL,
      },
    });
  }

  const unique = [...new Map(records.map(record => [record.externalId, record])).values()];
  const complete = expected > 0 && rowNodes.length === expected && unique.length === expected;
  return { records: unique, expected, rowNodes: rowNodes.length, complete };
}

export async function syncOklahomaPublicBids() {
  try {
    const html = await fetchBoard();
    const parsed = parseBoard(html);
    if (!parsed.records.length) throw new Error("No current Oklahoma bidding events parsed");
    if (!parsed.complete) throw new Error(`Oklahoma board reconciliation failed: expected ${parsed.expected}, rows ${parsed.rowNodes}, parsed ${parsed.records.length}`);
    const source: SledSourceConfig = {
      adapterKey: "peoplesoft_ok",
      sourceName: "Oklahoma Public Bidding Opportunities",
      baseUrl: PUBLIC_URL,
      jurisdiction: "Oklahoma",
      sourceType: "portal",
    };
    const persisted = await persistSledOpportunities(source, parsed.records, {
      mode: "oklahoma_peoplesoft_public_refresh",
      recordChanges: true,
      closeMissing: true,
    });
    return { ok: true, stateCode: "OK", rowsFound: parsed.records.length, resultCount: parsed.expected, complete: true, ...persisted };
  } catch (error) {
    return { ok: false, stateCode: "OK", rowsFound: 0, resultCount: null, complete: false, stored: 0, newRecords: 0, changedRecords: 0, closedRecords: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
