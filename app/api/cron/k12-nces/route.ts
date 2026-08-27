import { NextRequest, NextResponse } from "next/server";
import { syncNcesDistrictBatch, STATE_FIPS } from "@/lib/k12/nces-districts";
import { consolidateExactK12Duplicates, reclassifyClearlyNonLeas, repairNcesIdsFromDistrictUrls } from "@/lib/k12/repair-nces";
import { reconcileExtendedNcesAliases } from "@/lib/k12/reconcile-extended-aliases";
import { reconcileNcesAliasesByWebsiteHost } from "@/lib/k12/reconcile-website-hosts";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALL_STATES = Object.keys(STATE_FIPS).sort();
const SHARD_COUNT = 10;
const SLOT_MS = 5 * 60 * 1000;

function shardForSlot(date: Date) {
  return Math.floor(date.getTime() / SLOT_MS) % SHARD_COUNT;
}

export async function GET(request: NextRequest) {
  const auth = requireInternalAuth(request);
  if (auth) return auth;

  const now = new Date();
  const shard = shardForSlot(now);
  const states = ALL_STATES.filter((_, index) => index % SHARD_COUNT === shard);

  try {
    const nonLea = await reclassifyClearlyNonLeas();
    const repair = await repairNcesIdsFromDistrictUrls();
    const dedupe = await consolidateExactK12Duplicates();
    const websiteHostAliases = await reconcileNcesAliasesByWebsiteHost();
    const extendedAliases = await reconcileExtendedNcesAliases();
    const results = await syncNcesDistrictBatch(states);
    const totals = results.reduce(
      (acc, row) => {
        acc.ncesTotal += row.ncesTotal;
        acc.rowsParsed += row.rowsParsed;
        acc.inserted += row.inserted;
        acc.updated += row.updated;
        acc.existing += row.existing;
        return acc;
      },
      { ncesTotal: 0, rowsParsed: 0, inserted: 0, updated: 0, existing: 0 },
    );
    const failures = results.filter(row => row.error);

    if (failures.length) {
      console.warn("NCES shard partial failure", {
        shard,
        states,
        failures: failures.map(row => ({ stateCode: row.stateCode, error: row.error })),
      });
    }

    return NextResponse.json({
      ok: failures.length === 0,
      partial: failures.length > 0,
      shard,
      shardCount: SHARD_COUNT,
      states,
      nonLea,
      repair,
      dedupe,
      websiteHostAliases,
      extendedAliases,
      totals,
      failures,
      results,
    }, { status: failures.length ? 207 : 200 });
  } catch (error) {
    console.error("NCES shard failed", {
      shard,
      states,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, shard, states, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
