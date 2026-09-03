import type { SledOpportunityRecord } from "@/lib/sled/types";
import { classifyLowVoltage } from "@/lib/lv-classifier";

const SAM_SEARCH_URL = "https://api.sam.gov/opportunities/v2/search";
export const LV_SAM_NAICS = ["238210", "561621", "237130"] as const;

const DESCRIPTION_CONCURRENCY = 8;

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

type EnrichedRaw = SamRaw & { descriptionText?: string | null };

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

function normalizeDescription(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchDescription(raw: SamRaw, apiKey: string) {
  const link = raw.description?.trim();
  if (!link || !/^https?:\/\//i.test(link)) return link || null;
  try {
    const url = new URL(link);
    url.searchParams.set("api_key", apiKey);
    const response = await fetch(url.toString(), { cache: "no-store", headers: { accept: "text/plain,text/html,application/json" } });
    if (!response.ok) return null;
    const body = await response.text();
    return normalizeDescription(body).slice(0, 120_000) || null;
  } catch {
    return null;
  }
}

async function enrichDescriptions(raw: SamRaw[], apiKey: string) {
  const output: EnrichedRaw[] = new Array(raw.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= raw.length) return;
      const item = raw[index];
      output[index] = { ...item, descriptionText: await fetchDescription(item, apiKey) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(DESCRIPTION_CONCURRENCY, raw.length || 1) }, () => worker()));
  return output;
}

function mapOpportunity(raw: EnrichedRaw): SledOpportunityRecord {
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
    description: raw.descriptionText || null,
    solicitationType: raw.type || raw.baseType || null,
    procurementMechanism: "SAM.gov federal notice",
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
      descriptionUrl: raw.description || null,
    },
  };
}

function isEarlyNotice(raw: SamRaw) {
  const type = `${raw.type || ""} ${raw.baseType || ""}`.toLowerCase();
  return type.includes("pre-solicitation") || type.includes("presolicitation") || type.includes("sources sought");
}

async function fetchSearchPage(apiKey: string, naics: string, pageSize: number, pageOffset: number, from: Date, today: Date) {
  const params = new URLSearchParams({
    api_key: apiKey,
    postedFrom: dateMMDDYYYY(from),
    postedTo: dateMMDDYYYY(today),
    limit: String(pageSize),
    offset: String(pageOffset),
    ncode: naics,
  });
  for (const ptype of ["p", "r", "o", "k"]) params.append("ptype", ptype);

  const response = await fetch(`${SAM_SEARCH_URL}?${params.toString()}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`SAM.gov NAICS ${naics} returned ${response.status}`);
  return await response.json() as SamResponse;
}

export async function discoverSamLV(limit = 300, offset = 0, daysBack = 30) {
  const apiKey = process.env.SAM_GOV_API_KEY;
  if (!apiKey) {
    return { configured: false, totalRecords: 0, scanned: 0, signals: [], pursuits: [], rejected: 0, failures: ["SAM_GOV_API_KEY not configured"] };
  }

  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - Math.max(1, Math.min(365, daysBack)));
  const totalLimit = Math.max(1, Math.min(300, Math.floor(limit)));
  const pageOffset = Math.max(0, Math.floor(offset));
  const perNaics = Math.max(1, Math.ceil(totalLimit / LV_SAM_NAICS.length));

  const payloads = await Promise.all(LV_SAM_NAICS.map(async naics => {
    try {
      const payload = await fetchSearchPage(apiKey, naics, perNaics, pageOffset, from, today);
      return { naics, payload, error: null as string | null };
    } catch (error) {
      return { naics, payload: null as SamResponse | null, error: error instanceof Error ? error.message : String(error) };
    }
  }));

  const failures = payloads.flatMap(item => item.error ? [item.error] : []);
  const totalRecords = payloads.reduce((sum, item) => sum + (item.payload?.totalRecords || 0), 0);
  const raw = payloads.flatMap(item => item.payload?.opportunitiesData || []);
  const uniqueRaw = [...new Map(raw.map(item => [item.noticeId || item.solicitationNumber || `${item.title}-${item.postedDate}`, item])).values()]
    .filter(isOpen)
    .slice(0, totalLimit);
  const enriched = await enrichDescriptions(uniqueRaw, apiKey);

  const classified = enriched.map(rawItem => {
    const opportunity = mapOpportunity(rawItem);
    const classification = classifyLowVoltage({
      title: opportunity.title,
      description: opportunity.description,
      scope: [
        opportunity.naicsCodes?.length ? `NAICS ${opportunity.naicsCodes.join(" ")}` : "",
        String(opportunity.rawPayload.classificationCode || ""),
      ].filter(Boolean).join(" "),
    });
    return { raw: rawItem, opportunity, classification };
  }).filter(item => item.classification.accepted);

  const signals = classified
    .filter(item => isEarlyNotice(item.raw))
    .map(({ opportunity, classification }) => ({ opportunity, classification }))
    .sort((a, b) => b.classification.score - a.classification.score);
  const pursuits = classified
    .filter(item => !isEarlyNotice(item.raw))
    .map(({ opportunity, classification }) => ({ opportunity, classification }))
    .sort((a, b) => b.classification.score - a.classification.score);

  return {
    configured: true,
    naics: [...LV_SAM_NAICS],
    totalRecords,
    scanned: uniqueRaw.length,
    descriptionsFetched: enriched.filter(item => Boolean(item.descriptionText)).length,
    signals,
    pursuits,
    accepted: signals.length + pursuits.length,
    rejected: uniqueRaw.length - signals.length - pursuits.length,
    failures,
    offset: pageOffset,
    limit: totalLimit,
  };
}
