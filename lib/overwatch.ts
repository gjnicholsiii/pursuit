import type { CustomerProfile } from "@/lib/customer-profile";

const USA_SPENDING_AWARDS = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const DAY = 86_400_000;

export type OverwatchAward = {
  awardId: string;
  recipient: string;
  agency: string;
  subAgency: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  lastModifiedDate: string | null;
  amount: number;
  naics: string | null;
  psc: string | null;
  generatedId: string | null;
  daysToEnd: number;
  signalScore: number;
};

export type OverwatchFeed = {
  awards: OverwatchAward[];
  generatedAt: string;
  warnings: string[];
  filters: string[];
};

type UsaResult = Record<string, unknown>;
type UsaResponse = { results?: UsaResult[]; page_metadata?: { hasNext?: boolean } };

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function daysUntil(value: string | null, now: Date) {
  if (!value) return Number.POSITIVE_INFINITY;
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  return Math.ceil((date.getTime() - now.getTime()) / DAY);
}

function scoreSignal(row: UsaResult, daysToEnd: number, now: Date) {
  let score = 48;
  const modified = text(row["Last Modified Date"]);
  if (modified) {
    const modifiedAt = new Date(modified);
    const age = Number.isNaN(modifiedAt.getTime()) ? 9999 : (now.getTime() - modifiedAt.getTime()) / DAY;
    if (age <= 90) score += 12;
    else if (age <= 180) score += 8;
    else if (age <= 365) score += 4;
  }
  if (daysToEnd <= 180) score += 13;
  else if (daysToEnd <= 365) score += 10;
  else if (daysToEnd <= 540) score += 6;
  else if (daysToEnd <= 730) score += 3;
  if (numeric(row["Award Amount"]) > 0) score += 4;
  if (text(row.NAICS) || text(row.PSC)) score += 4;
  return Math.max(35, Math.min(91, score));
}

async function searchAwards(profile: CustomerProfile | null, mode: "naics" | "psc" | "broad", page: number, now: Date) {
  const start = new Date(now.getTime() - 730 * DAY);
  const filters: Record<string, unknown> = {
    award_type_codes: ["A", "B", "C", "D"],
    time_period: [{ start_date: isoDate(start), end_date: isoDate(now), date_type: "action_date" }],
  };

  if (mode === "naics" && profile?.naicsCodes.length) {
    filters.naics_codes = { require: profile.naicsCodes.slice(0, 12) };
  }
  if (mode === "psc" && profile?.pscCodes.length) {
    filters.psc_codes = profile.pscCodes.slice(0, 12);
  }

  const response = await fetch(USA_SPENDING_AWARDS, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filters,
      fields: [
        "Award ID",
        "Recipient Name",
        "Awarding Agency",
        "Awarding Sub Agency",
        "Description",
        "Start Date",
        "End Date",
        "Last Modified Date",
        "Award Amount",
        "NAICS",
        "PSC",
        "generated_internal_id",
      ],
      sort: "Last Modified Date",
      order: "desc",
      limit: 100,
      page,
      subawards: false,
      spending_level: "awards",
    }),
    next: { revalidate: 21_600 },
  });

  if (!response.ok) throw new Error(`USAspending returned ${response.status}`);
  return (await response.json()) as UsaResponse;
}

export async function getOverwatchFeed(profile: CustomerProfile | null): Promise<OverwatchFeed> {
  const now = new Date();
  const warnings: string[] = [];
  const filters: string[] = [];
  const modes: Array<"naics" | "psc" | "broad"> = [];

  if (profile?.naicsCodes.length) {
    modes.push("naics");
    filters.push(`NAICS ${profile.naicsCodes.slice(0, 6).join(", ")}`);
  }
  if (profile?.pscCodes.length) {
    modes.push("psc");
    filters.push(`PSC ${profile.pscCodes.slice(0, 6).join(", ")}`);
  }
  if (!modes.length) {
    modes.push("broad");
    filters.push("Federal contracts — broad feed");
  }

  const raw: UsaResult[] = [];
  for (const mode of modes) {
    try {
      for (let page = 1; page <= 3; page += 1) {
        const result = await searchAwards(profile, mode, page, now);
        raw.push(...(result.results || []));
        if (!result.page_metadata?.hasNext) break;
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "USAspending feed unavailable");
    }
  }

  const seen = new Set<string>();
  const awards: OverwatchAward[] = [];
  for (const row of raw) {
    const awardId = text(row["Award ID"]);
    const generatedId = text(row.generated_internal_id) || null;
    const key = generatedId || awardId;
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const endDate = text(row["End Date"]) || null;
    const daysToEnd = daysUntil(endDate, now);
    if (!Number.isFinite(daysToEnd) || daysToEnd < -30 || daysToEnd > 730) continue;

    awards.push({
      awardId,
      recipient: text(row["Recipient Name"]) || "Recipient unavailable",
      agency: text(row["Awarding Agency"]) || "Agency unavailable",
      subAgency: text(row["Awarding Sub Agency"]) || "",
      description: text(row.Description) || "Federal contract",
      startDate: text(row["Start Date"]) || null,
      endDate,
      lastModifiedDate: text(row["Last Modified Date"]) || null,
      amount: numeric(row["Award Amount"]),
      naics: text(row.NAICS) || null,
      psc: text(row.PSC) || null,
      generatedId,
      daysToEnd,
      signalScore: scoreSignal(row, daysToEnd, now),
    });
  }

  awards.sort((a, b) => a.daysToEnd - b.daysToEnd || b.signalScore - a.signalScore || b.amount - a.amount);

  return {
    awards: awards.slice(0, 240),
    generatedAt: now.toISOString(),
    warnings: Array.from(new Set(warnings)),
    filters,
  };
}
