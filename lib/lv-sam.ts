import type { SledOpportunityRecord } from "@/lib/sled/types";
import { classifyLowVoltage } from "@/lib/lv-classifier";

const SAM_SEARCH_URL = "https://api.sam.gov/opportunities/v2/search";

type PlacePart = { code?: string | null; name?: string | null };
type SamPlace = {
  city?: PlacePart | null;
  state?: PlacePart | null;
  country?: PlacePart | null;
  zip?: string | null;
};

type SamRaw = {
  noticeId?: string | null;
  title?: string | null;
  solicitationNumber?: string | null;
  fullParentPathName?: string | null;
  department?: string | null;
  subTier?: string | null;
  office?: string | null;
  postedDate?: string | null;
  type?: string | null;
  baseType?: string | null;
  responseDeadLine?: string | null;
  naicsCode?: string | null;
  classificationCode?: string | null;
  active?: string | null;
  placeOfPerformance?: SamPlace | null;
  resourceLinks?: string[] | null;
  description?: string | null;
  uiLink?: string | null;
};

type SamResponse = {
  totalRecords?: number;
  limit?: number;
  offset?: number;
  opportunitiesData?: SamRaw[];
};

function dateMMDDYYYY(date: Date) {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

function agencyName(raw: SamRaw) {
  if (raw.fullParentPathName) {
    const parts = raw.fullParentPathName.split(".").map(part => part.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return raw.office || raw.subTier || raw.department || "Federal agency";
}

function stateCode(raw: SamRaw) {
  return raw.placeOfPerformance?.state?.code || null;
}

function cityName(raw: SamRaw) {
  return raw.placeOfPerformance?.city?.name || null;
}

function isOpen(raw: SamRaw) {
  if (String(raw.active || "").toLowerCase() === "no") return false;
  if (!raw.responseDeadLine) return true;
  const due = new Date(raw.responseDeadLine).getTime();
  return !Number.isFinite(due) || due >= Date.now();
}

function sourceUrl(raw: SamRaw) {
  if (raw.uiLink) return raw.uiLink;
  const id = raw.noticeId || raw.solicitationNumber;
  return id ? `https://sam.gov/opp/${encodeURIComponent(id)}/view` : "https://sam.gov/content/opportunities";
}

function mapOpportunity(raw: SamRaw): SledOpportunityRecord {
  const id = raw.noticeId || raw.solicitationNumber || crypto.randomUUID();
  const agency = agencyName(raw);
  const state = stateCode(raw);
  const city = cityName(raw);
  return {
    externalId: `sam:${id}`,
    agency: {
      key: `sam:${raw.office || raw.subTier || raw.department || agency}`,
      name: agency,
      agencyType: "federal_agency",
      jurisdictionLevel: "federal",
      stateCode: state,
      city,
      website: "https://sam.gov",
    },
    title: raw.title?.trim() || "Untitled federal opportunity",
    description: raw.description || null,
    solicitationType: raw.type || raw.baseType || null,
    procurementMechanism: "SAM.gov federal solicitation",
    status: isOpen(raw) ? "open" : "closed",
    issueDate: raw.postedDate || null,
    dueAt: raw.responseDeadLine || null,
    prebidAt: null,
    estimatedValue: null,
    stateCode: state,
    city,
    naicsCodes: raw.naicsCode ? [raw.naicsCode] : [],
    setAside: null,
    sourceUrl: sourceUrl(raw),
    rawPayload: {
      platform: "SAM.gov",
      noticeId: raw.noticeId || null,
      solicitationNumber: raw.solicitationNumber || null,
      department: raw.department || null,
      subTier: raw.subTier || null,
      office: raw.office || null,
      naicsCode: raw.naicsCode || null,
      classificationCode: raw.classificationCode || null,
      resourceLinks: raw.resourceLinks || [],
    },
  };
}

export async function discoverSamLV(limit = 1000, offset = 0, daysBack = 30) {
  const apiKey = process.env.SAM_GOV_API_KEY;
  if (!apiKey) {
    return { configured: false, totalRecords: 0, scanned: 0, pursuits: [], rejected: 0, error: "SAM_GOV_API_KEY not configured" };
  }

  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - Math.max(1, Math.min(365, daysBack)));
  const pageSize = Math.max(1, Math.min(1000, Math.floor(limit)));
  const pageOffset = Math.max(0, Math.floor(offset));
  const params = new URLSearchParams({
    api_key: apiKey,
    postedFrom: dateMMDDYYYY(from),
    postedTo: dateMMDDYYYY(today),
    limit: String(pageSize),
    offset: String(pageOffset),
  });
  params.append("ptype", "o");
  params.append("ptype", "k");

  const response = await fetch(`${SAM_SEARCH_URL}?${params.toString()}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    return { configured: true, totalRecords: 0, scanned: 0, pursuits: [], rejected: 0, error: `SAM.gov returned ${response.status}` };
  }

  const payload = await response.json() as SamResponse;
  const raw = Array.isArray(payload.opportunitiesData) ? payload.opportunitiesData : [];
  const pursuits = raw
    .map(mapOpportunity)
    .filter(item => item.status === "open")
    .map(opportunity => ({
      opportunity,
      classification: classifyLowVoltage({
        title: opportunity.title,
        description: opportunity.description,
        scope: [
          opportunity.naicsCodes?.length ? `NAICS ${opportunity.naicsCodes.join(" ")}` : "",
          String(opportunity.rawPayload.classificationCode || ""),
        ].filter(Boolean).join(" "),
      }),
    }))
    .filter(item => item.classification.accepted)
    .sort((a, b) => b.classification.score - a.classification.score);

  return {
    configured: true,
    totalRecords: payload.totalRecords || raw.length,
    scanned: raw.length,
    pursuits,
    rejected: raw.length - pursuits.length,
    offset: pageOffset,
    limit: pageSize,
  };
}
