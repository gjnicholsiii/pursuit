import { STATE_PROCUREMENT_REGISTRY, type StateProcurementSource } from "@/lib/sled/state-registry";

type StateOverride = Partial<Omit<StateProcurementSource, "stateCode" | "stateName">>;

// Live observations override the NASPO baseline when a portal has transitioned or
// Pursuit has directly verified a connector against the current public system.
const CURRENT_OVERRIDES: Record<string, StateOverride> = {
  AL: {
    connectorFamily: "cgi_advantage",
    platformLabel: "STAARS Vendor Self Service / CGI Advantage AltSelfService",
    officialUrl: "https://procurement.staars.alabama.gov/",
    status: "live",
    notes: "Pursuit reproduces Alabama STAARS Public Access through the session-specific CGI Advantage AltSelfService workflow, paginates the complete Open solicitation board, and closes records that leave the live set. Production validation reconciled 14 current opportunities across 2 pages.",
  },
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
  CA: {
    connectorFamily: "oracle_peoplesoft",
    platformLabel: "Cal eProcure / PeopleSoft Supplier Portal",
    officialUrl: "https://caleprocure.ca.gov/",
    status: "live",
    notes: "Pursuit uses California's anonymous PeopleSoft bidder session and verifies the complete portal-reported event set before storing current posted opportunities. The production validation reconciled all 356 reported events.",
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
  KS: {
    status: "live",
    notes: "Kansas eSupplier public bid events are live through a PeopleSoft connector with explicit cookie-session handling. Pursuit verified and stored the current public event set end-to-end.",
  },
  KY: {
    status: "live",
    notes: "Reusable CGI Advantage connector verified end-to-end against Kentucky Vendor Self Service with a complete public solicitation sweep.",
  },
  LA: {
    connectorFamily: "direct_state_board",
    platformLabel: "Louisiana LaPAC public network (SAP/LaGov downstream)",
    officialUrl: "https://wwwcfprd.doa.louisiana.gov/OSP/LaPAC/pubMain.cfm",
    status: "live",
    notes: "Pursuit verified the complete set of non-empty LaPAC department bid boards, including public documents and addenda, and closes opportunities that disappear from the live board.",
  },
  ME: {
    connectorFamily: "cgi_advantage",
    platformLabel: "CGI Advantage Vendor Self Service (AltSelfService)",
    officialUrl: "https://mevss.hostams.com/PRDVSS1X1/AltSelfService",
    status: "live",
    notes: "Pursuit reproduces Maine VSS public guest navigation through the legacy AltSelfService interface, paginates the complete Open solicitation board, and closes records that leave the live set. Production validation reconciled all 24 open solicitations across 3 pages.",
  },
  MA: {
    status: "live",
    notes: "Reusable Periscope connector verified end-to-end with complete pagination across state, higher-ed, municipal, and K-12 buyers.",
  },
  MI: {
    status: "live",
    notes: "Reusable CGI Advantage connector verified end-to-end against Michigan SIGMA Vendor Self Service with a complete public solicitation sweep.",
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
    status: "live",
    notes: "Pursuit verified the complete current Nebraska DAS bid table end-to-end and closes opportunities that disappear from the public board.",
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
  NY: {
    connectorFamily: "direct_state_board",
    platformLabel: "New York State Contract Reporter",
    officialUrl: "https://www.nyscr.ny.gov/Ads/Search",
    status: "live",
    notes: "Pursuit verified a complete open-opportunity sweep across all Contract Reporter result pages. Direct public-buyer notices are stored; private contractor advertisements are intentionally excluded.",
  },
  NC: {
    connectorFamily: "custom",
    platformLabel: "North Carolina electronic Vendor Portal (eVP) / Microsoft Power Pages",
    officialUrl: "https://evp.nc.gov/solicitations/?status=0",
    status: "live",
    notes: "Pursuit reproduces the public eVP Power Pages grid session and Open solicitation metafilter, reconciles all grid pages to the portal-reported total, and closes records that leave the live set. Production validation reconciled all 280 open solicitations.",
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
    status: "live",
    notes: "Pursuit verifies every active SCBO category in each refresh, covering state, local, higher-ed and K-12 buyers, and closes ads that disappear from the current edition.",
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
  VA: {
    connectorFamily: "custom",
    platformLabel: "Virginia eVA Vendor Bulletin Board / Solr public search",
    officialUrl: "https://eva.virginia.gov/",
    status: "live",
    notes: "Pursuit reproduces the eVA public VBO session and queries the complete source-reported Open set through the public Solr bridge. Production validation reconciled all 565 source-open records; 3 past-due rows still marked Open by eVA are excluded from actionable Pursuit opportunities, leaving 562 current opportunities.",
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
