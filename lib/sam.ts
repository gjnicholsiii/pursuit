import { Opportunity } from "./types";
import { persistSamOpportunities, type SamPersistenceResult } from "./sam-persistence";

const SAM_SEARCH_URL = "https://api.sam.gov/opportunities/v2/search";
const SAM_PAGE_THROTTLE_MS = 16000;

interface SamPlacePart { code?: string | null; name?: string | null }
interface SamPlace {
  city?: SamPlacePart | null;
  state?: SamPlacePart | null;
  country?: SamPlacePart | null;
  zip?: string | null;
}

export interface SamOpportunityRaw {
  noticeId?: string;
  title?: string;
  solicitationNumber?: string | null;
  fullParentPathName?: string | null;
  department?: string | null;
  subTier?: string | null;
  office?: string | null;
  postedDate?: string | null;
  type?: string | null;
  baseType?: string | null;
  typeOfSetAsideDescription?: string | null;
  typeOfSetAside?: string | null;
  responseDeadLine?: string | null;
  naicsCode?: string | null;
  classificationCode?: string | null;
  active?: string | null;
  placeOfPerformance?: SamPlace | null;
  resourceLinks?: string[] | null;
  description?: string | null;
  uiLink?: string | null;
}

interface SamSearchResponse {
  totalRecords?: number;
  limit?: number;
  offset?: number;
  opportunitiesData?: SamOpportunityRaw[];
}

export interface SamLoadResult {
  configured: boolean;
  opportunities: Opportunity[];
  totalRecords: number;
  pageOffset?: number;
  pageSize?: number;
  rawCount?: number;
  error?: string;
  persistence?: SamPersistenceResult;
  persistenceError?: string;
}

export interface SamInventorySyncResult {
  totalRecords: number;
  pagesProcessed: number;
  startOffset: number;
  lastOffset: number;
  recordsSeen: number;
  stored: number;
  newRecords: number;
  changedRecords: number;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDateMMDDYYYY(date: Date) {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${date.getUTCFullYear()}`;
}

function displayDate(value?: string | null) {
  if (!value) return "Not stated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function agencyName(raw: SamOpportunityRaw) {
  if (raw.fullParentPathName) {
    const parts = raw.fullParentPathName.split(".").filter(Boolean);
    return parts[parts.length - 1] || raw.fullParentPathName;
  }
  return raw.office || raw.subTier || raw.department || "Federal agency";
}

function locationName(place?: SamPlace | null) {
  if (!place) return "Location not stated";
  const city = place.city?.name;
  const state = place.state?.code || place.state?.name;
  if (city && state) return `${city}, ${state}`;
  return city || state || place.country?.name || place.country?.code || "Location not stated";
}

function confidenceFor(raw: SamOpportunityRaw) {
  let score = 38;
  if (raw.responseDeadLine) score += 8;
  if (raw.solicitationNumber) score += 6;
  if (raw.naicsCode) score += 6;
  if (raw.typeOfSetAside || raw.typeOfSetAsideDescription) score += 6;
  if (raw.placeOfPerformance) score += 5;
  if (raw.resourceLinks?.length) score += 7;
  if (raw.description) score += 4;
  return Math.min(score, 78);
}

function mapOpportunity(raw: SamOpportunityRaw): Opportunity {
  const verified: string[] = [];
  const uncertainty: string[] = [];

  if (raw.responseDeadLine) verified.push("Response deadline published by SAM.gov");
  else uncertainty.push("Response deadline not present in the SAM.gov record");

  if (raw.typeOfSetAsideDescription || raw.typeOfSetAside) {
    verified.push(`Set-aside: ${raw.typeOfSetAsideDescription || raw.typeOfSetAside}`);
  } else {
    uncertainty.push("Set-aside status not stated in the feed record");
  }

  if (raw.naicsCode) verified.push(`NAICS ${raw.naicsCode}`);
  else uncertainty.push("NAICS code not present in the feed record");

  if (raw.resourceLinks?.length) verified.push(`${raw.resourceLinks.length} linked resource${raw.resourceLinks.length === 1 ? "" : "s"} identified`);
  else uncertainty.push("Bid-package attachments have not yet been acquired by Pursuit");

  uncertainty.push("Full solicitation package has not yet been analyzed");

  return {
    id: raw.noticeId || raw.solicitationNumber || crypto.randomUUID(),
    agency: agencyName(raw),
    title: raw.title?.trim() || "Untitled federal opportunity",
    location: locationName(raw.placeOfPerformance),
    value: null,
    due: displayDate(raw.responseDeadLine),
    confidence: confidenceFor(raw),
    eligibility: "review",
    procurementPath: raw.type || raw.baseType || "Federal opportunity",
    stage: "new",
    source: "SAM.gov live feed",
    sourceUrl: raw.uiLink || undefined,
    solicitationNumber: raw.solicitationNumber || undefined,
    naicsCode: raw.naicsCode || undefined,
    setAside: raw.typeOfSetAsideDescription || raw.typeOfSetAside || undefined,
    tags: ["Federal", raw.type || "Opportunity"].filter(Boolean) as string[],
    verified,
    uncertainty,
    nextStep: "Open the source package. Pursuit will raise confidence only after the solicitation and attachments are acquired and analyzed."
  };
}

export async function loadSamOpportunities(
  limit = 20,
  offset = 0,
  shouldPersist = true,
  fresh = false,
  mode = "interactive",
): Promise<SamLoadResult> {
  const apiKey = process.env.SAM_GOV_API_KEY;
  if (!apiKey) return { configured: false, opportunities: [], totalRecords: 0 };

  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 14);

  const pageSize = Math.max(1, Math.min(Math.floor(limit), 1000));
  const pageOffset = Math.max(0, Math.floor(offset));
  const params = new URLSearchParams({
    api_key: apiKey,
    postedFrom: formatDateMMDDYYYY(from),
    postedTo: formatDateMMDDYYYY(today),
    limit: String(pageSize),
    offset: String(pageOffset),
  });
  params.append("ptype", "o");
  params.append("ptype", "k");

  try {
    const response = await fetch(`${SAM_SEARCH_URL}?${params.toString()}`, fresh
      ? { cache: "no-store", headers: { Accept: "application/json" } }
      : { next: { revalidate: 900 }, headers: { Accept: "application/json" } });

    if (!response.ok) {
      return {
        configured: true,
        opportunities: [],
        totalRecords: 0,
        pageOffset,
        pageSize,
        error: `SAM.gov returned ${response.status}`,
      };
    }

    const payload = (await response.json()) as SamSearchResponse;
    const rawOpportunities = payload.opportunitiesData || [];
    const opportunities = rawOpportunities
      .map(mapOpportunity)
      .sort((a, b) => b.confidence - a.confidence);

    let persistence: SamPersistenceResult | undefined;
    let persistenceError: string | undefined;
    if (shouldPersist && process.env.DATABASE_URL && rawOpportunities.length) {
      try {
        persistence = await persistSamOpportunities(rawOpportunities, {
          mode,
          offset: pageOffset,
          totalRecords: payload.totalRecords || rawOpportunities.length,
        });
      } catch (error) {
        persistenceError = error instanceof Error ? error.message : "Unable to persist SAM.gov records";
      }
    }

    return {
      configured: true,
      opportunities,
      totalRecords: payload.totalRecords || opportunities.length,
      pageOffset,
      pageSize,
      rawCount: rawOpportunities.length,
      persistence,
      persistenceError,
    };
  } catch (error) {
    return {
      configured: true,
      opportunities: [],
      totalRecords: 0,
      pageOffset,
      pageSize,
      error: error instanceof Error ? error.message : "Unable to reach SAM.gov",
    };
  }
}

export async function syncSamInventory(pageSize = 1000, startOffset = 0): Promise<SamInventorySyncResult> {
  const safePageSize = Math.max(1, Math.min(Math.floor(pageSize), 1000));
  const safeStartOffset = Math.max(0, Math.floor(startOffset));
  let totalRecords = 0;
  let pagesProcessed = 0;
  let recordsSeen = 0;
  let stored = 0;
  let newRecords = 0;
  let changedRecords = 0;
  let lastOffset = safeStartOffset - 1;

  for (let offset = safeStartOffset; offset < 100; offset += 1) {
    if (pagesProcessed > 0) await sleep(SAM_PAGE_THROTTLE_MS);

    let page = await loadSamOpportunities(safePageSize, offset, true, true, "scheduled_full_sync");
    if (page.error === "SAM.gov returned 429") {
      await sleep(30000);
      page = await loadSamOpportunities(safePageSize, offset, true, true, "scheduled_full_sync");
    }

    if (!page.configured) throw new Error("SAM_GOV_API_KEY is not configured");
    if (page.error) throw new Error(page.error);
    if (page.persistenceError) throw new Error(page.persistenceError);

    totalRecords = page.totalRecords;
    pagesProcessed += 1;
    lastOffset = offset;
    recordsSeen += page.rawCount || 0;
    stored += page.persistence?.stored || 0;
    newRecords += page.persistence?.newRecords || 0;
    changedRecords += page.persistence?.changedRecords || 0;

    if (!page.rawCount || (offset + 1) * safePageSize >= totalRecords) break;
  }

  return {
    totalRecords,
    pagesProcessed,
    startOffset: safeStartOffset,
    lastOffset,
    recordsSeen,
    stored,
    newRecords,
    changedRecords,
  };
}
