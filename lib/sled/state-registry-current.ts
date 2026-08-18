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
  AK: {
    status: "partial",
    notes: "CGI Advantage guest connector verified end-to-end against Alaska IRIS VSS. The verified sweep completed successfully but returned no open solicitations, so Pursuit keeps Alaska partial until a non-zero live sweep is observed.",
  },
  CO: {
    status: "live",
    notes: "Reusable CGI Advantage connector verified end-to-end against Colorado VSS with a complete public solicitation sweep and live records stored in Pursuit.",
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
    status: "live",
    notes: "GA@WORK went live July 1, 2026. Pursuit verified the public JAGGAER event feed and a complete result sweep against the portal-reported total.",
  },
  IA: {
    status: "live",
    notes: "Reusable JAGGAER connector verified against Iowa IMPACS with a complete result sweep matching the portal-reported total.",
  },
  ID: {
    connectorFamily: "infor_luma",
    platformLabel: "IPRO powered by Luma / Infor CloudSuite Public Sector",
    officialUrl: "https://purchasing.idaho.gov/",
    status: "planned",
    notes: "Idaho replaced its former JAGGAER eProcurement path with IPRO powered by Luma. Luma procurement uses Infor CloudSuite Public Sector and Infor Supplier Portal/Strategic Sourcing.",
  },
  IL: {
    status: "live",
    notes: "Reusable Periscope connector verified against anonymous Open Bids with complete PrimeFaces pagination and portal-total reconciliation.",
  },
  LA: {
    connectorFamily: "direct_state_board",
    platformLabel: "Louisiana LaPAC public network (SAP/LaGov downstream)",
    officialUrl: "https://wwwcfprd.doa.louisiana.gov/OSP/LaPAC/pubMain.cfm",
    status: "planned",
    notes: "Direct LaPAC connector is staged against official public department listings. LaPAC exposes open bids, documents and addenda without vendor login; production validation is pending the next deliberate release.",
  },
  ME: {
    connectorFamily: "cgi_advantage",
    platformLabel: "CGI Advantage Vendor Self Service (AltSelfService)",
    officialUrl: "https://mevss.hostams.com/PRDVSS1X1/AltSelfService",
    status: "planned",
    notes: "Maine moved all solicitations into VSS effective October 1, 2025. Public guest access is verified, but Maine uses the legacy AltSelfService interface and requires a dedicated parser rather than the reusable Advantage4 connector.",
  },
  MA: {
    status: "live",
    notes: "Reusable Periscope connector verified end-to-end with complete pagination across state, higher-ed, municipal, and K-12 buyers.",
  },
  MN: {
    status: "partial",
    notes: "Official Minnesota OSP public SWIFT solicitation postings verified. Goods/services feed is directly readable; professional/technical feed is additive when available.",
  },
  MT: {
    status: "live",
    notes: "Reusable JAGGAER connector verified against Montana eMACS with a complete result sweep matching the portal-reported total.",
  },
  NE: {
    connectorFamily: "direct_state_board",
    platformLabel: "Nebraska DAS Materiel public bid board",
    officialUrl: "https://das.nebraska.gov/materiel/bid-opportunities.html",
    status: "planned",
    notes: "Direct official connector is staged. The public board exposes solicitation number, agency, type, buyer, posted date, opening date and bid-detail links; production validation is pending the next deliberate release.",
  },
  NM: {
    connectorFamily: "custom",
    platformLabel: "eProNM/JAGGAER transition to new procurement platform",
    officialUrl: "https://generalservices.state.nm.us/state-purchasing/",
    status: "planned",
    notes: "New Mexico says eProNM/JAGGAER is being replaced in summer 2026. Pursuit will not promote the legacy JAGGAER route until the current replacement platform is identified and verified.",
  },
  NV: {
    status: "live",
    notes: "Reusable Periscope connector verified against NevadaEPro with complete PrimeFaces pagination and portal-total reconciliation.",
  },
  NJ: {
    status: "live",
    notes: "Reusable Periscope connector verified against NJSTART with complete PrimeFaces pagination and portal-total reconciliation.",
  },
  OR: {
    officialUrl: "https://oregonbuys.gov/bso/",
    status: "live",
    notes: "Reusable Periscope connector verified end-to-end with complete pagination across state, city, and county buyers.",
  },
  PA: {
    connectorFamily: "jaggaer",
    platformLabel: "JAGGAER + PA eMarketplace",
    officialUrl: "https://www.pa.gov/agencies/dgs/procurement-resources/supplier-service-center",
    status: "live",
    notes: "Pennsylvania DGS directs suppliers to the CommonwealthPA JAGGAER public-event feed. Pursuit verified a complete result sweep matching the portal-reported total.",
  },
  SC: {
    connectorFamily: "direct_state_board",
    platformLabel: "South Carolina Business Opportunities (SCBO)",
    officialUrl: "https://scbo.sc.gov/online-edition",
    status: "partial",
    notes: "SCBO is the state's definitive public advertisement database and includes state, local, higher-ed and K-12 buyers. A direct full-category connector is staged; production validation is pending the next deliberate release.",
  },
  TX: {
    connectorFamily: "direct_state_board",
    platformLabel: "Texas SmartBuy Electronic State Business Daily (ESBD)",
    officialUrl: "https://www.txsmartbuy.gov/esbd",
    status: "partial",
    notes: "Public ESBD connector is staged with a bounded recent-active sweep. ESBD includes state and participating local public purchasers; deeper historical paging is intentionally excluded from frequent refreshes.",
  },
  UT: {
    status: "live",
    notes: "Reusable JAGGAER connector verified against Utah public events with a complete result sweep matching the portal-reported total.",
  },
  WV: {
    status: "live",
    notes: "Reusable CGI Advantage connector verified end-to-end against wvOASIS Vendor Self Service with a complete public solicitation sweep and live records stored in Pursuit.",
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
    verifiedAt: "2026-08-18",
    totalStates: CURRENT_STATE_PROCUREMENT_REGISTRY.length,
    byStatus,
    byFamily,
  };
}
