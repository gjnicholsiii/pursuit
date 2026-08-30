import { NextRequest, NextResponse } from "next/server";
import { syncNcesDistrictBatch, STATE_FIPS } from "@/lib/k12/nces-districts";
import { consolidateExactK12Duplicates, reclassifyClearlyNonLeas, repairNcesIdsFromDistrictUrls } from "@/lib/k12/repair-nces";
import { reconcileExtendedNcesAliases } from "@/lib/k12/reconcile-extended-aliases";
import { reconcileNcesAliasesByWebsiteHost } from "@/lib/k12/reconcile-website-hosts";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALL_STATES = Object.keys(STATE_FIPS).sort();
// One jurisdiction per invocation keeps authoritative NCES ingestion comfortably
// inside the function ceiling. At a five-minute cadence the full national cycle
// still completes in under five hours.
const SHARD_COUNT = ALL_STATES.length;
const SLOT_MS = 5 * 60 * 1000;

function shardForSlot(date: Date) {
  return Math.floor(date.getTime() / SLOT_MS) % SHARD_COUNT;
}

type CleanupStep = { ok: boolean; result?: unknown; error?: string; skipped?: boolean };
type RegistryAudit = {
  k12_total: number;
  with_nces_id: number;
  missing_nces_id: number;
  state_count: number;
  duplicate_nces_ids: number;
  duplicate_state_names: number;
};

async function runCleanupStep(name: string, fn: () => Promise<unknown>): Promise<CleanupStep> {
  try { return { ok: true, result: await fn() }; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("NCES reconciliation cleanup failed", { step: name, error: message });
    return { ok: false, error: message };
  }
}

async function auditNationalRegistry(): Promise<RegistryAudit> {
  const sql = getSql();
  const rows = await sql.query(`
    select
      count(*)::int as k12_total,
      count(*) filter (where nullif(trim(nces_id),'') is not null)::int as with_nces_id,
      count(*) filter (where nullif(trim(nces_id),'') is null)::int as missing_nces_id,
      count(distinct state_code) filter (where nullif(trim(state_code),'') is not null)::int as state_count,
      (select count(*)::int from (select nces_id from agencies where agency_type='k12' and nullif(trim(nces_id),'') is not null group by nces_id having count(*) > 1) x) as duplicate_nces_ids,
      (select count(*)::int from (select state_code, lower(trim(canonical_name)) normalized_name from agencies where agency_type='k12' and nullif(trim(state_code),'') is not null and nullif(trim(canonical_name),'') is not null group by state_code, lower(trim(canonical_name)) having count(*) > 1) x) as duplicate_state_names
    from agencies where agency_type='k12'
  `) as RegistryAudit[];
  return rows[0] ?? { k12_total:0, with_nces_id:0, missing_nces_id:0, state_count:0, duplicate_nces_ids:0, duplicate_state_names:0 };
}

export async function GET(request: NextRequest) {
  const auth = requireInternalAuth(request);
  if (auth) return auth;

  const shard = shardForSlot(new Date());
  const states = [ALL_STATES[shard]].filter(Boolean);
  // Heavy national reconciliation is intentionally decoupled from 55 of 56
  // ingestion runs. It executes once per complete national cycle rather than
  // competing with every authoritative state sync.
  const runCleanup = shard === 0;

  try {
    let cleanup: Record<string, CleanupStep> = {
      nonLea:{ok:true,skipped:true}, repair:{ok:true,skipped:true}, dedupe:{ok:true,skipped:true},
      websiteHostAliases:{ok:true,skipped:true}, extendedAliases:{ok:true,skipped:true},
    };
    if (runCleanup) {
      const [nonLea, repair, dedupe, websiteHostAliases, extendedAliases] = await Promise.all([
        runCleanupStep("reclassify-non-lea", reclassifyClearlyNonLeas),
        runCleanupStep("repair-nces-ids", repairNcesIdsFromDistrictUrls),
        runCleanupStep("consolidate-duplicates", consolidateExactK12Duplicates),
        runCleanupStep("website-host-aliases", reconcileNcesAliasesByWebsiteHost),
        runCleanupStep("extended-aliases", reconcileExtendedNcesAliases),
      ]);
      cleanup = { nonLea, repair, dedupe, websiteHostAliases, extendedAliases };
    }

    const results = await syncNcesDistrictBatch(states);
    const totals = results.reduce((acc,row)=>{acc.ncesTotal+=row.ncesTotal;acc.rowsParsed+=row.rowsParsed;acc.inserted+=row.inserted;acc.updated+=row.updated;acc.existing+=row.existing;return acc;},{ncesTotal:0,rowsParsed:0,inserted:0,updated:0,existing:0});
    const failures = results.filter(row => row.error);
    const cleanupFailures = Object.entries(cleanup).filter(([,v])=>!v.ok).map(([step,v])=>({step,error:v.error}));
    const registryAudit = await auditNationalRegistry();
    const registryHealthy = registryAudit.duplicate_nces_ids === 0 && registryAudit.duplicate_state_names === 0;

    console.info("NCES_REGISTRY_AUDIT", { shard, states, runCleanup, ...registryAudit, registryHealthy });
    if (failures.length) console.warn("NCES shard partial failure", { shard, states, failures: failures.map(row=>({stateCode:row.stateCode,error:row.error})) });

    return NextResponse.json({
      ok: failures.length === 0,
      partial: failures.length > 0 || cleanupFailures.length > 0 || !registryHealthy,
      shard, shardCount: SHARD_COUNT, states, runCleanup, cleanup, cleanupFailures, totals,
      registryAudit, registryHealthy, failures, results,
    }, { status: failures.length ? 207 : 200 });
  } catch (error) {
    console.error("NCES shard failed", { shard, states, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ ok:false, shard, states, error:error instanceof Error?error.message:String(error) }, { status:500 });
  }
}
