import { NextRequest, NextResponse } from "next/server";
import { syncNcesDistrictBatch, STATE_FIPS } from "@/lib/k12/nces-districts";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALL_STATES = Object.keys(STATE_FIPS).sort();
const SHARD_COUNT = 5;

function shardForHour(date: Date) {
  return date.getUTCHours() % SHARD_COUNT;
}

export async function GET(request: NextRequest) {
  const auth = requireInternalAuth(request);
  if (auth) return auth;

  const now = new Date();
  const shard = shardForHour(now);
  const states = ALL_STATES.filter((_, index) => index % SHARD_COUNT === shard);

  try {
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

    return NextResponse.json({
      ok: true,
      shard,
      shardCount: SHARD_COUNT,
      states,
      totals,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, shard, states, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
