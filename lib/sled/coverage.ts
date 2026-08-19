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

  return CURRENT_STATE_PROCUREMENT_REGISTRY.map(registryState => {
    const state = registryState.stateCode === "NH"
      ? {
          ...registryState,
          connectorFamily: "infor" as const,
          platformLabel: "NHProcurement / New Hampshire Statewide Bids and Proposals",
          officialUrl: "https://apps.das.nh.gov/NHProcurement",
          status: "blocked" as const,
          notes: "Current 2026 New Hampshire DAS bid documents direct vendors to NHProcurement, while legacy solicitations still reference the Statewide Bids and Proposals board. Production probes of both official surfaces return Akamai Access Denied to Vercel before procurement content is exposed. Pursuit cannot claim deterministic server-side ingestion until an official structured feed or server-accessible route is available.",
        }
      : registryState.stateCode === "OK"
        ? {
            ...registryState,
            connectorFamily: "oracle_peoplesoft" as const,
            platformLabel: "Oklahoma Financials / PeopleSoft Public Bidding Events",
            officialUrl: "https://financials.ok.gov/psc/SOKLFP1DS/SUPPLIER/ERP/c/SCP_PUBLIC_MENU_FL.SCP_PUB_BID_CMP_FL.GBL",
            status: "live" as const,
            notes: "Oklahoma OMES identifies this public Bidding Opportunities page as the statewide source for all current open solicitations, including statewide contract opportunities. Pursuit establishes the anonymous PeopleSoft supplier session, parses the complete public Bidding Event Information grid, reconciles the portal-reported row count before writes, and closes records only after a complete sweep. Production validation reconciled 16 of 16 current bidding events, followed by a stable repeat with no changes.",
          }
        : registryState.stateCode === "RI"
          ? {
              ...registryState,
              connectorFamily: "proactis_webprocure" as const,
              platformLabel: "Ocean State Procures / Proactis WebProcure + RIVIP external solicitations",
              officialUrl: "https://ridop.ri.gov/bidding-opportunities",
              status: "blocked" as const,
              notes: "Rhode Island uses Ocean State Procures for centralized State Agency and RIDOT solicitations and RIVIP for municipalities, school districts, quasi-public agencies, higher education, and delegated-authority or grant solicitations. Production cannot reach the public OSP WebProcure backend before an HTTP response. Pursuit reproduced the RIVIP legacy search and listing workflow across all 129 listed external entities; both the Active(Scheduled) query and an all-status control returned zero records. With no usable RIVIP records and the current centralized OSP board unreachable from Vercel, Rhode Island is blocked until OSP becomes server-accessible or another official structured source is available.",
            }
          : registryState.stateCode === "SD"
            ? {
                ...registryState,
                connectorFamily: "esm_solutions" as const,
                platformLabel: "South Dakota Central Bid Exchange / ESM + SDDOT SDEBS + Office of State Engineer",
                officialUrl: "https://www.sd.gov/bhra?id=kb_article_view&sysparm_article=KB0044779",
                status: "partial" as const,
                notes: "Pursuit has two verified production sources in South Dakota: the Central Bid Exchange / ESM current-events API and SDDOT SDEBS currently advertised highway lettings. Production reconciles 42 of 42 current ESM events plus 6 SDDOT projects across 2 advertised lettings, with stable repeat runs and Neon verification. South Dakota remains partial because the Office of the State Engineer maintains a separate construction Bids & Proposals page. Its public ServiceNow shell and page API are server-accessible, but the live article body is not exposed in the deterministic server payload Pursuit can currently ingest.",
              }
            : registryState.stateCode === "VT"
              ? {
                  ...registryState,
                  connectorFamily: "ivalua" as const,
                  platformLabel: "VTBuys / Ivalua",
                  officialUrl: "https://vtbuys.suppliers.vermont.gov/",
                  status: "blocked" as const,
                  notes: "Vermont's current eProcurement system is VTBuys on Ivalua. Current State solicitations direct bidders to VTBuys for submission and updates. Production probing from Vercel confirms the anonymous Ivalua public solicitation browse route redirects to the platform browser-check/login flow, while an alternate public-bids route returns 401 Access Denied. Pursuit cannot claim deterministic server-side ingestion until VTBuys exposes a server-accessible public solicitation route or official structured feed.",
                }
              : registryState;
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
