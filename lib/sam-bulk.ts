import { Readable } from "node:stream";
import { parse } from "csv-parse";
import { getSql } from "@/lib/db";
import { persistSamOpportunities } from "@/lib/sam-persistence";
import type { SamOpportunityRaw } from "@/lib/sam";

const SAM_BULK_URL = "https://s3.amazonaws.com/falextracts/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv";
const BATCH_SIZE = 300;
const EXCLUDED_TYPES = new Set(["Award Notice", "Sale of Surplus Property"]);

interface SamBulkRow {
  NoticeId?: string;
  Title?: string;
  "Sol#"?: string;
  "Department/Ind.Agency"?: string;
  "Sub-Tier"?: string;
  Office?: string;
  PostedDate?: string;
  Type?: string;
  BaseType?: string;
  SetASideCode?: string;
  SetASide?: string;
  ResponseDeadLine?: string;
  NaicsCode?: string;
  ClassificationCode?: string;
  PopCity?: string;
  PopState?: string;
  PopZip?: string;
  PopCountry?: string;
  Active?: string;
  Link?: string;
  Description?: string;
}

export interface SamBulkSyncResult {
  rowsRead: number;
  rowsEligible: number;
  stored: number;
  newRecords: number;
  changedRecords: number;
  batches: number;
  startedAt: string;
  completedAt: string;
  bootstrap: boolean;
}

function clean(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function mapBulkRow(row: SamBulkRow): SamOpportunityRaw | null {
  const noticeId = clean(row.NoticeId);
  const solicitationNumber = clean(row["Sol#"]);
  const type = clean(row.Type);
  const active = clean(row.Active);

  if (!noticeId && !solicitationNumber) return null;
  if (active && active.toLowerCase() !== "yes") return null;
  if (type && EXCLUDED_TYPES.has(type)) return null;

  const department = clean(row["Department/Ind.Agency"]);
  const subTier = clean(row["Sub-Tier"]);
  const office = clean(row.Office);
  const fullParentPathName = [department, subTier, office].filter(Boolean).join(".") || undefined;
  const city = clean(row.PopCity);
  const state = clean(row.PopState);
  const country = clean(row.PopCountry);
  const zip = clean(row.PopZip);

  return {
    noticeId,
    title: clean(row.Title),
    solicitationNumber,
    fullParentPathName,
    department,
    subTier,
    office,
    postedDate: clean(row.PostedDate),
    type,
    baseType: clean(row.BaseType),
    typeOfSetAsideDescription: clean(row.SetASide),
    typeOfSetAside: clean(row.SetASideCode),
    responseDeadLine: clean(row.ResponseDeadLine),
    naicsCode: clean(row.NaicsCode),
    classificationCode: clean(row.ClassificationCode),
    active,
    placeOfPerformance: city || state || country || zip ? {
      city: city ? { name: city } : undefined,
      state: state ? { code: state, name: state } : undefined,
      country: country ? { code: country, name: country } : undefined,
      zip,
    } : undefined,
    description: clean(row.Description),
    uiLink: noticeId ? `https://sam.gov/opp/${noticeId}/view` : clean(row.Link),
  };
}

async function markMissingRecordsClosed(syncStartedAt: string) {
  const sql = getSql();
  await sql.query(
    `update opportunities o
     set status = 'closed'
     from sources s
     where o.source_id = s.id
       and s.adapter_key = 'sam_gov'
       and o.status = 'open'
       and o.last_seen_at < $1::timestamptz`,
    [syncStartedAt],
  );
}

export async function syncSamBulkFeed(bootstrap = false): Promise<SamBulkSyncResult> {
  const startedAt = new Date().toISOString();
  const response = await fetch(SAM_BULK_URL, { cache: "no-store" });
  if (!response.ok || !response.body) {
    throw new Error(`SAM.gov bulk feed returned ${response.status}`);
  }

  const parser = Readable.fromWeb(response.body as never).pipe(parse({
    columns: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
  }));

  let rowsRead = 0;
  let rowsEligible = 0;
  let stored = 0;
  let newRecords = 0;
  let changedRecords = 0;
  let batches = 0;
  let batch: SamOpportunityRaw[] = [];

  const flush = async () => {
    if (!batch.length) return;
    const result = await persistSamOpportunities(batch, {
      mode: bootstrap ? "sam_bulk_bootstrap" : "sam_bulk_daily",
      recordChanges: !bootstrap,
    });
    stored += result.stored;
    newRecords += result.newRecords;
    changedRecords += result.changedRecords;
    batches += 1;
    batch = [];
  };

  for await (const rawRow of parser) {
    rowsRead += 1;
    const opportunity = mapBulkRow(rawRow as SamBulkRow);
    if (!opportunity) continue;

    rowsEligible += 1;
    batch.push(opportunity);
    if (batch.length >= BATCH_SIZE) await flush();
  }

  await flush();
  await markMissingRecordsClosed(startedAt);

  return {
    rowsRead,
    rowsEligible,
    stored,
    newRecords,
    changedRecords,
    batches,
    startedAt,
    completedAt: new Date().toISOString(),
    bootstrap,
  };
}
