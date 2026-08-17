import { STATE_PROCUREMENT_REGISTRY, type StateProcurementSource } from "@/lib/sled/state-registry";

type StateOverride = Partial<Omit<StateProcurementSource, "stateCode" | "stateName">>;

// Live observations override the NASPO baseline when a portal has transitioned or
// Pursuit has directly verified a connector against the current public system.
const CURRENT_OVERRIDES: Record<string, StateOverride> = {
  AR: {
    connectorFamily: "sap_ariba",
    platformLabel: "SAP Ariba (current); Periscope ARBuy (legacy solicitations)",
    officialUrl: "https://sas.arkansas.gov/procurement",
    status: "planned",
    notes: "Arkansas transitioned new procurement activity to SAP Ariba in July 2026. ARBuy remains for solicitations opened before the transition.",
  },
  IA: {
    status: "partial",
    notes: "Reusable JAGGAER connector verified against Iowa IMPACS public events. Full pagination still required.",
  },
  IL: {
    status: "partial",
    notes: "Reusable Periscope connector verified against anonymous Open Bids. Full pagination still required before complete coverage.",
  },
  MA: {
    status: "partial",
    notes: "Reusable Periscope connector verified against anonymous Open Bids, including state, higher-ed, municipal, and K-12 buyers. Full pagination still required.",
  },
  MN: {
    status: "partial",
    notes: "Official Minnesota OSP public SWIFT solicitation postings verified. Goods/services feed is directly readable; professional/technical feed is additive when available.",
  },
  MT: {
    status: "partial",
    notes: "Reusable JAGGAER connector verified against Montana eMACS public events. Full pagination still required.",
  },
  NV: {
    status: "partial",
    notes: "Reusable Periscope connector verified against anonymous Open Bids. Full pagination still required before complete coverage.",
  },
  NJ: {
    status: "partial",
    notes: "Reusable Periscope connector verified against anonymous Open Bids. Full pagination still required before complete coverage.",
  },
  OR: {
    officialUrl: "https://oregonbuys.gov/bso/",
    status: "partial",
    notes: "Reusable Periscope connector verified against anonymous Open Bids, including state, city, and county buyers. Full pagination still required.",
  },
  UT: {
    status: "partial",
    notes: "Reusable JAGGAER connector verified against Utah public events. Current public list fits on one page.",
  },
  WI: {
    status: "blocked",
    notes: "Wisconsin eSupplier public solicitation route currently redirects server-side requests to PeopleSoft login; alternate official public source required.",
  },
};

export const CURRENT_STATE_PROCUREMENT_REGISTRY: StateProcurementSource[] = STATE_PROCUREMENT_REGISTRY.map(state => ({
  ...state,
  ...(CURRENT_OVERRIDES[state.stateCode] || {}),
}));

export function summarizeCurrentStateCoverage() {
  const byStatus = CURRENT_STATE_PROCUREMENT_REGISTRY.reduce<Record<string, number>>((acc, state) => {
    acc[state.status] = (acc[state.status] || 0) + 1;
    return acc;
  }, {});

  const byFamily = CURRENT_STATE_PROCUREMENT_REGISTRY.reduce<Record<string, string[]>>((acc, state) => {
    (acc[state.connectorFamily] ||= []).push(state.stateCode);
    return acc;
  }, {});

  return {
    verifiedAt: "2026-08-17",
    totalStates: CURRENT_STATE_PROCUREMENT_REGISTRY.length,
    byStatus,
    byFamily,
  };
}
