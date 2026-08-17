import { Opportunity } from "./types";

const SAM_SEARCH_URL = "https://api.sam.gov/opportunities/v2/search";

interface SamPlacePart { code?: string | null; name?: string | null }
interface SamPlace {
  city?: SamPlacePart | null;
  state?: SamPlacePart | null;
  country?: SamPlacePart | null;
  zip?: string | null;
}

interface SamOpportunityRaw {
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
  error?: string;
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
  let score = 38; // Feed metadata alone is never treated as a fully read bid package.
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

export async function loadSamOpportunities(limit = 20): Promise<SamLoadResult> {
  const apiKey = process.env.SAM_GOV_API_KEY;
  if (!apiKey) return { configured: false, opportunities: [], totalRecords: 0 };

  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 14);

  const params = new URLSearchParams({
    api_key: apiKey,
    postedFrom: formatDateMMDDYYYY(from),
    postedTo: formatDateMMDDYYYY(today),
    limit: String(Math.min(limit, 100)),
    offset: "0",
  });
  params.append("ptype", "o");
  params.append("ptype", "k");

  try {
    const response = await fetch(`${SAM_SEARCH_URL}?${params.toString()}`, {
      next: { revalidate: 900 },
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return {
        configured: true,
        opportunities: [],
        totalRecords: 0,
        error: `SAM.gov returned ${response.status}`,
      };
    }

    const payload = (await response.json()) as SamSearchResponse;
    const opportunities = (payload.opportunitiesData || [])
      .map(mapOpportunity)
      .sort((a, b) => b.confidence - a.confidence);

    return {
      configured: true,
      opportunities,
      totalRecords: payload.totalRecords || opportunities.length,
    };
  } catch (error) {
    return {
      configured: true,
      opportunities: [],
      totalRecords: 0,
      error: error instanceof Error ? error.message : "Unable to reach SAM.gov",
    };
  }
}
