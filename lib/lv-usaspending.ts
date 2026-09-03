import { classifyLowVoltage } from "@/lib/lv-classifier";
import { scoreRebid } from "@/lib/lv-rebid-score";

const API = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const LV_NAICS = ["561621", "238210", "541512"];
const DAY = 86_400_000;

type RawAward = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export type LVFederalContract = {
  awardId: string;
  generatedId: string | null;
  incumbent: string;
  agency: string;
  subAgency: string;
  description: string;
  amount: number;
  startDate: string | null;
  endDate: string | null;
  lastModifiedDate: string | null;
  naics: string | null;
  classification: ReturnType<typeof classifyLowVoltage>;
  rebid: ReturnType<typeof scoreRebid>;
};

async function fetchPage(page: number) {
  const now = new Date();
  const start = new Date(now.getTime() - 4 * 365 * DAY);
  const response = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      filters: {
        award_type_codes: ["A", "B", "C", "D"],
        time_period: [{ start_date: dateOnly(start), end_date: dateOnly(now), date_type: "action_date" }],
        naics_codes: { require: LV_NAICS },
      },
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
        "generated_internal_id",
      ],
      sort: "Last Modified Date",
      order: "desc",
      limit: 100,
      page,
      subawards: false,
      spending_level: "awards",
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`USAspending returned ${response.status}`);
  return await response.json() as { results?: RawAward[]; page_metadata?: { hasNext?: boolean } };
}

export async function discoverFederalLVContracts(maxPages = 3, startPage = 1) {
  const raw: RawAward[] = [];
  const failures: string[] = [];
  const firstPage = Math.max(1, Math.floor(startPage));
  const pageCount = Math.max(1, Math.min(20, Math.floor(maxPages)));
  for (let page = firstPage; page < firstPage + pageCount; page += 1) {
    try {
      const result = await fetchPage(page);
      raw.push(...(result.results || []));
      if (!result.page_metadata?.hasNext) break;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      break;
    }
  }

  const seen = new Set<string>();
  const contracts: LVFederalContract[] = [];
  for (const row of raw) {
    const awardId = text(row["Award ID"]);
    const generatedId = text(row.generated_internal_id) || null;
    const key = generatedId || awardId;
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const description = text(row.Description);
    const classification = classifyLowVoltage({ title: description, description });
    if (!classification.accepted) continue;

    const endDate = text(row["End Date"]) || null;
    if (endDate) {
      const end = new Date(`${endDate.slice(0, 10)}T12:00:00Z`).getTime();
      if (Number.isFinite(end) && end < Date.now() - 120 * DAY) continue;
    }

    const amount = number(row["Award Amount"]);
    const rebid = scoreRebid({
      currentEndDate: endDate,
      contractValue: amount,
      incumbentStillActive: true,
    });

    contracts.push({
      awardId,
      generatedId,
      incumbent: text(row["Recipient Name"]) || "Unknown incumbent",
      agency: text(row["Awarding Agency"]) || "Unknown agency",
      subAgency: text(row["Awarding Sub Agency"]),
      description: description || "Low-voltage federal contract",
      amount,
      startDate: text(row["Start Date"]) || null,
      endDate,
      lastModifiedDate: text(row["Last Modified Date"]) || null,
      naics: text(row.NAICS) || null,
      classification,
      rebid,
    });
  }

  contracts.sort((a, b) => b.rebid.score - a.rebid.score || b.amount - a.amount);
  return { naics: LV_NAICS, startPage: firstPage, pagesRequested: pageCount, scanned: raw.length, accepted: contracts.length, contracts, failures };
}
