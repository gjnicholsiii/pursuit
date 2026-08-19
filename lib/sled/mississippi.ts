import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const BOARD_URL = "https://www.ms.gov/dfa/contract_bid_search/Bid?autoloadGrid=true";
const DATA_URL = "https://www.ms.gov/dfa/contract_bid_search/Bid/BidData?AppId=1&Status=Open";
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

const SOURCE: SledSourceConfig = {
  adapterKey: "magic_public_ms",
  sourceName: "Mississippi Procurement Opportunity and Public Notification Search",
  baseUrl: BOARD_URL,
  jurisdiction: "Mississippi",
  sourceType: "portal",
};

type MsAttachment = { AttachmentID?: number; Description?: string | null; Url?: string | null };
type MsBid = {
  AdditionalInfo?: string | null; AdvertiseDate?: string | null; AdvertiseTime?: string | null;
  Agency?: string | null; AgencyNumber?: string | null; Attachments?: MsAttachment[] | null;
  BidDescription?: string | null; BidID?: number; BidNumber?: string | null; BidStatus?: string | null;
  BidType?: string | null; BuyerEmail?: string | null; BuyerName?: string | null; BuyerPhone?: string | null;
  ObjectID?: string | null; OpeningDate?: string | null; OpeningTime?: string | null; PDFUrl?: string | null;
  ProcurementCategoryDescription?: string | null; ProcurementCategoryID?: string | null;
  SubmissionDate?: string | null; SubmissionTime?: string | null; SubProcurementCategoryDescription?: string | null;
  SubProcurementCategoryID?: string | null; VerNumber?: string | null;
};
type MsGrid = { iTotalRecords?: number; iTotalDisplayRecords?: number; aaData?: MsBid[] };

export interface MississippiSyncResult {
  stateCode: "MS"; sourceName: string; ok: boolean; sourceCount: number; rowsFetched: number;
  actionableRows: number; staleRows: number; complete: boolean; stored: number; newRecords: number;
  changedRecords: number; closedRecords: number; error?: string;
}

function formBody() {
  const form = new URLSearchParams();
  form.set("sEcho", "1"); form.set("iDisplayStart", "0"); form.set("iDisplayLength", "9999");
  form.set("iColumns", "9"); form.set("sSearch", "");
  const columns = ["Agency", "BidNumber", "ObjectID", "VerNumber", "BidStatus", "AdvertiseDate", "SubmissionDate", "OpeningDate", "BidID"];
  for (let i = 0; i < columns.length; i += 1) {
    form.set(`mDataProp_${i}`, columns[i]); form.set(`bSearchable_${i}`, "true");
    form.set(`bSortable_${i}`, i === 8 ? "false" : "true"); form.set(`sSearch_${i}`, ""); form.set(`bRegex_${i}`, "false");
  }
  form.set("iSortingCols", "0");
  return form.toString();
}

function dotNetDate(value?: string | null) {
  if (!value) return null;
  const match = value.match(/\/Date\((-?\d+)/);
  if (!match) return null;
  const ms = Number(match[1]);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function isoDateTime(dateValue?: string | null, timeValue?: string | null) {
  const date = dotNetDate(dateValue);
  if (!date) return null;
  if (!timeValue) return date.toISOString();
  const [hours = "00", minutes = "00", seconds = "00"] = timeValue.split(":");
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const probe = new Date(`${localDate}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "longOffset" }).formatToParts(probe);
  const offset = parts.find(part => part.type === "timeZoneName")?.value.replace("GMT", "") || "-06:00";
  return new Date(`${localDate}T${hours}:${minutes}:${seconds}${offset}`).toISOString();
}

function agencyType(name: string) {
  const value = name.toLowerCase();
  if (/university|college|school|education/.test(value)) return "education" as const;
  if (/county|city|town|village|municip|utility|water|airport|authority|district/.test(value)) return "local_agency" as const;
  return "state_agency" as const;
}

async function fetchOpenRows() {
  const response = await fetch(DATA_URL, {
    method: "POST",
    headers: { accept: "application/json,text/javascript,*/*;q=0.01", "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", "user-agent": UA, referer: BOARD_URL },
    body: formBody(), cache: "no-store",
  });
  if (!response.ok) throw new Error(`Mississippi bid grid returned ${response.status}`);
  const payload = (await response.json()) as MsGrid;
  const rows = Array.isArray(payload.aaData) ? payload.aaData : [];
  const sourceCount = Number(payload.iTotalDisplayRecords ?? payload.iTotalRecords);
  if (!Number.isFinite(sourceCount) || sourceCount < 0) throw new Error("Mississippi bid grid returned invalid total");
  const ids = rows.map(row => row.BidID).filter((id): id is number => Number.isFinite(id));
  const unique = new Set(ids);
  if (rows.length !== sourceCount || ids.length !== sourceCount || unique.size !== sourceCount) {
    throw new Error(`Mississippi reconciliation failed: count=${sourceCount}, rows=${rows.length}, ids=${ids.length}, unique=${unique.size}`);
  }
  return { sourceCount, rows };
}

export async function syncMississippiProcurement(): Promise<MississippiSyncResult> {
  try {
    const { sourceCount, rows } = await fetchOpenRows();
    const now = Date.now();
    let staleRows = 0;
    const records = rows.flatMap(row => {
      if (!row.BidID || !row.BidNumber || String(row.BidStatus || "").toLowerCase() !== "open") return [];
      const dueAt = isoDateTime(row.SubmissionDate, row.SubmissionTime) || isoDateTime(row.OpeningDate, row.OpeningTime);
      if (dueAt && new Date(dueAt).getTime() < now) { staleRows += 1; return []; }
      const agencyName = row.Agency?.trim() || "State of Mississippi";
      const type = agencyType(agencyName);
      const title = row.BidDescription?.trim() || `${row.BidType || "Procurement Opportunity"} ${row.BidNumber}`;
      const record: SledOpportunityRecord = {
        externalId: String(row.BidID),
        agency: { key: `mississippi-procurement:${row.AgencyNumber || agencyName}`, name: agencyName, agencyType: type, jurisdictionLevel: type === "state_agency" ? "state" : "local", stateCode: "MS", website: BOARD_URL },
        title,
        description: row.AdditionalInfo?.trim() || null,
        solicitationType: row.BidType || "Solicitation",
        procurementMechanism: "Mississippi public RFx / procurement opportunity search",
        status: "open",
        issueDate: isoDateTime(row.AdvertiseDate, row.AdvertiseTime),
        dueAt,
        stateCode: "MS",
        sourceUrl: BOARD_URL,
        rawPayload: {
          platform: "Mississippi MAGIC / MS.gov Procurement Search", bidId: row.BidID, bidNumber: row.BidNumber,
          objectId: row.ObjectID || null, bidStatus: row.BidStatus || null, bidType: row.BidType || null,
          agency: row.Agency || null, agencyNumber: row.AgencyNumber || null, buyerName: row.BuyerName || null,
          buyerEmail: row.BuyerEmail || null, buyerPhone: row.BuyerPhone || null,
          category: row.ProcurementCategoryDescription || null, categoryId: row.ProcurementCategoryID || null,
          subcategory: row.SubProcurementCategoryDescription || null, subcategoryId: row.SubProcurementCategoryID || null,
          pdfUrl: row.PDFUrl || null,
          attachments: (row.Attachments || []).map(attachment => ({ id: attachment.AttachmentID || null, description: attachment.Description || null, url: attachment.Url || null })),
          officialBoard: BOARD_URL,
        },
      };
      return [record];
    });
    const persisted = await persistSledOpportunities(SOURCE, records, { mode: "mississippi_public_open_refresh", recordChanges: true, closeMissing: true });
    return { stateCode: "MS", sourceName: SOURCE.sourceName, ok: true, sourceCount, rowsFetched: rows.length, actionableRows: records.length, staleRows, complete: true, ...persisted };
  } catch (error) {
    return { stateCode: "MS", sourceName: SOURCE.sourceName, ok: false, sourceCount: 0, rowsFetched: 0, actionableRows: 0, staleRows: 0, complete: false, stored: 0, newRecords: 0, changedRecords: 0, closedRecords: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
