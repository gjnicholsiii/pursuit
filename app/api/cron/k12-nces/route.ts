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

type CleanupStep = {
  ok: boolean;
  result?: unknown;
  error?: string;
};

async function runCleanupStep(name: string, fn: () => Promise<unknown>): Promise<CleanupStep> {
  try {
    return { ok: true, result: await fn() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("NCES reconciliation cleanup failed", { step: name, error: message });
    return { ok: false, error: message };
  }
}

export async function GET(request: NextRequest) {
  const auth = requireInternalAuth(request);
  if (auth) return auth;

  const now = new Date();
  const shard = shardForSlot(now);
  const states = ALL_STATES.filter((_, index) => index % SHARD_COUNT === shard);

  try {
    // Cleanup/reconciliation is valuable, but it must never prevent the
    // authoritative NCES shard itself from syncing. Each statement is atomic,
    // so a failed cleanup can be reported and retried on the next cycle while
    // fresh national coverage continues to ingest.
    const nonLea = await runCleanupStep("reclassify-non-lea", reclassifyClearlyNonLeas);
    const repair = await runCleanupStep("repair-nces-ids", repairNcesIdsFromDistrictUrls);
    const dedupe = await runCleanupStep("consolidate-duplicates", consolidateExactK12Duplicates);
    const websiteHostAliases = await runCleanupStep("website-host-aliases", reconcileNcesAliasesByWebsiteHost);
    const extendedAliases = await runCleanupStep("extended-aliases", reconcileExtendedNcesAliases);

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
    const cleanup = { nonLea, repair, dedupe, websiteHostAliases, extendedAliases };
    const cleanupFailures = Object.entries(cleanup)
      .filter(([, value]) => !value.ok)
      .map(([step, value]) => ({ step, error: value.error }));

    if (failures.length) {
      console.warn("NCES shard partial failure", {
        shard,
        states,
        failures: failures.map(row => ({ stateCode: row.stateCode, error: row.error })),
      });
    }

    return NextResponse.json({
      ok: failures.length === 0,
      partial: failures.length > 0 || cleanupFailures.length > 0,
      shard,
      shardCount: SHARD_COUNT,
      states,
      cleanup,
      cleanupFailures,
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
