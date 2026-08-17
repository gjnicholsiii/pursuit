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
  DE: {
    connectorFamily: "socrata_open_data",
    platformLabel: "Delaware MyMarketplace + Delaware Open Data",
    officialUrl: "https://mmp.delaware.gov/Bids",
    status: "partial",
    notes: "Official statewide Open Bids dataset has a direct structured connector and authoritative live bid-detail links. The open-data mirror refreshes weekly, so Pursuit treats it as verified but not yet real-time complete.",
  },
  GA: {
    connectorFamily: "jaggaer",
    platformLabel: "GA@WORK Marketplace / JAGGAER",
    officialUrl: "https://doas.ga.gov/accessing-gawork-procurement-systems",
    status: "partial",
    notes: "GA@WORK went live July 1, 2026. The supplier sourcing marketplace uses JAGGAER with a public State of Georgia event feed; 46 open events were observed during verification. Full pagination still required.",
  },
  IA: {
    status: "partial",
    notes: "Reusable JAGGAER connector verified against Iowa IMPACS public events. Full pagination still required.",
  },
  ID: {
    connectorFamily: "infor_luma",
    platformLabel: "IPRO powered by Luma / Infor CloudSuite Public Sector",
    officialUrl: "https://purchasing.idaho.gov/",
    status: "planned",
    notes: "Idaho replaced its former JAGGAER eProcurement path with IPRO powered by Luma. Luma procurement uses Infor CloudSuite Public Sector and Infor Supplier Portal/Strategic Sourcing.",
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
  PA: {
    connectorFamily: "jaggaer",
    platformLabel: "JAGGAER + PA eMarketplace",
    officialUrl: "https://www.pa.gov/agencies/dgs/procurement-resources/supplier-service-center",
    status: "partial",
    notes: "Pennsylvania DGS directs suppliers to the CommonwealthPA JAGGAER public-event feed. Reusable JAGGAER connector is staged; full pagination must be verified before complete coverage.",
  },
  UT: {
    status: "live",
    notes: "Reusable JAGGAER connector verified against Utah public events. Current public result set fits on one page and is fully captured.",
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
