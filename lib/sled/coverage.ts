import { getSql } from "@/lib/db";
import { CURRENT_STATE_PROCUREMENT_REGISTRY } from "@/lib/sled/state-registry-current";

export interface StateCoverageSnapshot {
  stateCode: string;
  stateName: string;
  platform: string;
  connectorFamily: string;
  registryStatus: string;
  sourceCount: number;
  openRecords: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  effectiveStatus: "live" | "partial" | "blocked" | "queued";
  gap: string | null;
}

function sourceMatchesState(adapterKey: string, stateCode: string) {
  const suffix = `_${stateCode.toLowerCase()}`;
  if (adapterKey.endsWith(suffix)) return true;
  if (stateCode === "IN" && adapterKey === "indiana_idoa") return true;
  if (stateCode === "TN" && adapterKey === "tennessee_cpo_public") return true;
  return false;
}

export async function getStateCoverageSnapshot(): Promise<StateCoverageSnapshot[]> {
  const sql = getSql();
  const rows = await sql`
    select
      s.adapter_key,
      s.last_success_at,
      s.last_failure_at,
      s.last_error,
      count(o.id)::int as total_records,
      count(o.id) filter (where o.status = 'open')::int as open_records
    from sources s
    left join opportunities o on o.source_id = s.id
    where s.source_family = 'sled'
       or s.adapter_key in ('indiana_idoa', 'tennessee_cpo_public')
       or s.adapter_key like 'periscope_%'
       or s.adapter_key like 'jaggaer_%'
       or s.adapter_key like 'peoplesoft_%'
    group by s.id, s.adapter_key, s.last_success_at, s.last_failure_at, s.last_error
  `;

  return CURRENT_STATE_PROCUREMENT_REGISTRY.map(state => {
    const matching = rows.filter(row => sourceMatchesState(String(row.adapter_key), state.stateCode));
    const sourceCount = matching.length;
    const openRecords = matching.reduce((sum, row) => sum + Number(row.open_records || 0), 0);
    const successful = matching
      .map(row => row.last_success_at ? new Date(row.last_success_at) : null)
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.getTime() - a.getTime())[0] || null;
    const failed = matching
      .map(row => row.last_failure_at ? new Date(row.last_failure_at) : null)
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.getTime() - a.getTime())[0] || null;
    const latestError = matching.find(row => row.last_error)?.last_error || null;

    let effectiveStatus: StateCoverageSnapshot["effectiveStatus"] = "queued";
    let gap: string | null = state.notes || null;

    if (state.status === "blocked") {
      effectiveStatus = "blocked";
      gap = state.notes || "Public procurement source is blocked from reliable server-side acquisition.";
    } else if (openRecords > 0 && state.status === "live") {
      effectiveStatus = "live";
      gap = null;
    } else if (openRecords > 0 || state.status === "partial") {
      effectiveStatus = "partial";
      if (!gap) gap = "Connector is verified but coverage is not yet complete.";
    }

    return {
      stateCode: state.stateCode,
      stateName: state.stateName,
      platform: state.platformLabel,
      connectorFamily: state.connectorFamily,
      registryStatus: state.status,
      sourceCount,
      openRecords,
      lastSuccessAt: successful?.toISOString() || null,
      lastFailureAt: failed?.toISOString() || null,
      lastError: latestError ? String(latestError) : null,
      effectiveStatus,
      gap,
    };
  });
}

export async function summarizeCoverageTruth() {
  const states = await getStateCoverageSnapshot();
  const summary = states.reduce(
    (acc, state) => {
      acc[state.effectiveStatus] += 1;
      acc.openRecords += state.openRecords;
      return acc;
    },
    { live: 0, partial: 0, blocked: 0, queued: 0, openRecords: 0 },
  );
  return { verifiedAt: new Date().toISOString(), summary, states };
}
