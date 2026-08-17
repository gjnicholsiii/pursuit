// Source map derived from NASPO eProcurement profiles; verified 2026-08-17.
// https://www.naspo.org/research-and-innovation/rosp-category/eprocurement/

export type StateCoverageStatus = "live" | "partial" | "blocked" | "planned";

export type StateConnectorFamily =
  | "oracle_peoplesoft"
  | "jaggaer"
  | "periscope_buyspeed"
  | "cgi_advantage"
  | "ivalua"
  | "sap_ariba"
  | "sap"
  | "proactis_webprocure"
  | "infor"
  | "infor_luma"
  | "socrata_open_data"
  | "direct_state_board"
  | "esm_solutions"
  | "public_purchase"
  | "eva_custom"
  | "webs_custom"
  | "custom"
  | "unknown_erp";

export interface StateProcurementSource {
  stateCode: string;
  stateName: string;
  connectorFamily: StateConnectorFamily;
  platformLabel: string;
  officialUrl: string;
  status: StateCoverageStatus;
  notes?: string;
}

export const STATE_PROCUREMENT_REGISTRY: StateProcurementSource[] = [
  { stateCode: "AL", stateName: "Alabama", connectorFamily: "ivalua", platformLabel: "Ivalua; InfoAdvantage by CGI", officialUrl: "https://alabamabuys.gov/page.aspx/en/usr/login?ReturnUrl=%2fpage.aspx%2fen%2fbuy%2fhomepage", status: "planned" },
  { stateCode: "AK", stateName: "Alaska", connectorFamily: "cgi_advantage", platformLabel: "IRIS by CGI", officialUrl: "http://doa.alaska.gov/dof/iris/", status: "planned" },
  { stateCode: "AZ", stateName: "Arizona", connectorFamily: "ivalua", platformLabel: "APP by Ivalua", officialUrl: "https://spo.az.gov/suppliers/app-support", status: "planned" },
  { stateCode: "AR", stateName: "Arkansas", connectorFamily: "periscope_buyspeed", platformLabel: "Periscope Holdings", officialUrl: "https://arbuy.arkansas.gov/bso/", status: "planned" },
  { stateCode: "CA", stateName: "California", connectorFamily: "oracle_peoplesoft", platformLabel: "PeopleSoft by Oracle", officialUrl: "https://caleprocure.ca.gov/pages/index.aspx", status: "planned" },
  { stateCode: "CO", stateName: "Colorado", connectorFamily: "cgi_advantage", platformLabel: "CGI; Cobblestone", officialUrl: "https://osc.colorado.gov/core-operations", status: "planned" },
  { stateCode: "CT", stateName: "Connecticut", connectorFamily: "proactis_webprocure", platformLabel: "PeopleSoft by Oracle; Proactis WebProcure", officialUrl: "https://portal.ct.gov/DAS/CTSource/CTSource", status: "planned" },
  { stateCode: "DE", stateName: "Delaware", connectorFamily: "jaggaer", platformLabel: "Jaggaer", officialUrl: "https://mymarketplace.delaware.gov/", status: "planned" },
  { stateCode: "FL", stateName: "Florida", connectorFamily: "sap_ariba", platformLabel: "Ariba On Demand", officialUrl: "https://www.dms.myflorida.com/business_operations/state_purchasing/myfloridamarketplace/welcome_to_myfloridamarketplace_mfmp", status: "planned" },
  { stateCode: "GA", stateName: "Georgia", connectorFamily: "jaggaer", platformLabel: "PeopleSoft by Oracle; Jaggaer", officialUrl: "https://doas.ga.gov/state-purchasing/team-georgia-marketplace", status: "planned" },
  { stateCode: "HI", stateName: "Hawaii", connectorFamily: "custom", platformLabel: "Hawaii eProcurement", officialUrl: "https://hiepro.ehawaii.gov/welcome.html", status: "planned" },
  { stateCode: "ID", stateName: "Idaho", connectorFamily: "jaggaer", platformLabel: "Jaggaer", officialUrl: "https://sms-idaho-prd.tam.inforgov.com/fsm/SupplyManagementSupplier/page/XiSupplyManagementSupplierPage?csk.SupplierGroup=LUMA", status: "planned" },
  { stateCode: "IL", stateName: "Illinois", connectorFamily: "periscope_buyspeed", platformLabel: "Periscope Holdings; SAP", officialUrl: "https://www.bidbuy.illinois.gov/bso/", status: "planned" },
  { stateCode: "IN", stateName: "Indiana", connectorFamily: "oracle_peoplesoft", platformLabel: "PeopleSoft by Oracle", officialUrl: "https://www.in.gov/idoa/procurement/supplier-resource-center/requirements-to-do-business-with-the-state/bidder-profile-registration/", status: "live", notes: "Direct official state feed live." },
  { stateCode: "IA", stateName: "Iowa", connectorFamily: "jaggaer", platformLabel: "Jaggaer", officialUrl: "https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=DASIowa", status: "planned" },
  { stateCode: "KS", stateName: "Kansas", connectorFamily: "oracle_peoplesoft", platformLabel: "PeopleSoft by Oracle", officialUrl: "https://smartweb.ks.gov/", status: "planned" },
  { stateCode: "KY", stateName: "Kentucky", connectorFamily: "cgi_advantage", platformLabel: "Advantage by CGI", officialUrl: "https://finance.ky.gov/eProcurement/Pages/default.aspx", status: "partial", notes: "Guest VSS solicitation grid confirmed; full pagination still being completed." },
  { stateCode: "LA", stateName: "Louisiana", connectorFamily: "sap", platformLabel: "SAP", officialUrl: "https://wwwcfprd.doa.louisiana.gov/osp/lapac/pubmain.cfm", status: "planned" },
  { stateCode: "ME", stateName: "Maine", connectorFamily: "cgi_advantage", platformLabel: "Advantage by CGI", officialUrl: "https://mevss.hostams.com/PRDVSS1X1/AltSelfService", status: "planned" },
  { stateCode: "MD", stateName: "Maryland", connectorFamily: "ivalua", platformLabel: "Ivalua", officialUrl: "https://emma.maryland.gov/page.aspx/en/usr/login?ReturnUrl=%2fpage.aspx%2fen%2fbuy%2fhomepage", status: "planned" },
  { stateCode: "MA", stateName: "Massachusetts", connectorFamily: "periscope_buyspeed", platformLabel: "MDF Commerce; Periscope Holdings", officialUrl: "https://www.commbuys.com/bso/", status: "planned" },
  { stateCode: "MI", stateName: "Michigan", connectorFamily: "cgi_advantage", platformLabel: "Advantage by CGI", officialUrl: "https://www.michigan.gov/dtmb/procurement/contractconnect", status: "planned" },
  { stateCode: "MN", stateName: "Minnesota", connectorFamily: "oracle_peoplesoft", platformLabel: "PeopleSoft by Oracle", officialUrl: "https://mn.gov/mmb/accounting/swift/", status: "planned" },
  { stateCode: "MS", stateName: "Mississippi", connectorFamily: "sap", platformLabel: "SAP", officialUrl: "https://www.dfa.ms.gov/magic-finance-and-grants-management", status: "planned" },
  { stateCode: "MO", stateName: "Missouri", connectorFamily: "proactis_webprocure", platformLabel: "WebProcure by Proactis", officialUrl: "https://missouribuys.mo.gov/", status: "blocked", notes: "Public solicitation UI exists; underlying service requires authentication from server-side requests." },
  { stateCode: "MT", stateName: "Montana", connectorFamily: "jaggaer", platformLabel: "Jaggaer", officialUrl: "https://spb.mt.gov/eMACS-Resources", status: "planned" },
  { stateCode: "NE", stateName: "Nebraska", connectorFamily: "unknown_erp", platformLabel: "ERP platform not specified by NASPO", officialUrl: "https://das.nebraska.gov/materiel/vendor-information.html", status: "planned" },
  { stateCode: "NV", stateName: "Nevada", connectorFamily: "periscope_buyspeed", platformLabel: "Periscope Holdings", officialUrl: "https://nevadaepro.com/bso/", status: "planned" },
  { stateCode: "NH", stateName: "New Hampshire", connectorFamily: "infor", platformLabel: "Infor", officialUrl: "https://das.nh.gov/purchasing/", status: "planned" },
  { stateCode: "NJ", stateName: "New Jersey", connectorFamily: "periscope_buyspeed", platformLabel: "Periscope Holdings", officialUrl: "https://www.njstart.gov/bso/", status: "planned" },
  { stateCode: "NM", stateName: "New Mexico", connectorFamily: "jaggaer", platformLabel: "Jaggaer; PeopleSoft by Oracle", officialUrl: "https://www.generalservices.state.nm.us/state-purchasing/online-procurement/", status: "planned" },
  { stateCode: "NY", stateName: "New York", connectorFamily: "oracle_peoplesoft", platformLabel: "PeopleSoft supplier portal", officialUrl: "https://esupplier.sfs.ny.gov/psc/fscm/SUPPLIER/ERP/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL?", status: "planned" },
  { stateCode: "NC", stateName: "North Carolina", connectorFamily: "sap_ariba", platformLabel: "SAP Ariba", officialUrl: "https://eprocurement.nc.gov/", status: "planned" },
  { stateCode: "ND", stateName: "North Dakota", connectorFamily: "oracle_peoplesoft", platformLabel: "PeopleSoft by Oracle", officialUrl: "https://www.omb.nd.gov/doing-business-state/procurement/state-procurement-online-spo-login", status: "planned" },
  { stateCode: "OH", stateName: "Ohio", connectorFamily: "ivalua", platformLabel: "Ivalua; PeopleSoft by Oracle", officialUrl: "https://procure.ohio.gov/state-and-local-agencies/resources/ohiobuys-overview", status: "blocked", notes: "Public OhioBuys route is protected by browser/reCAPTCHA controls." },
  { stateCode: "OK", stateName: "Oklahoma", connectorFamily: "oracle_peoplesoft", platformLabel: "PeopleSoft by Oracle", officialUrl: "https://oklahoma.gov/omes/divisions/central-purchasing/suppliers-and-payees/supplier-portal.html", status: "planned" },
  { stateCode: "OR", stateName: "Oregon", connectorFamily: "periscope_buyspeed", platformLabel: "BuySpeed by Periscope Holdings", officialUrl: "https://www.oregon.gov/das/procurement/pages/oregonbuys.aspx", status: "planned" },
  { stateCode: "PA", stateName: "Pennsylvania", connectorFamily: "jaggaer", platformLabel: "Jaggaer", officialUrl: "https://www.emarketplace.state.pa.us/", status: "planned" },
  { stateCode: "RI", stateName: "Rhode Island", connectorFamily: "proactis_webprocure", platformLabel: "Proactis", officialUrl: "https://ridop.ri.gov/ocean-state-procures-osp", status: "planned" },
  { stateCode: "SC", stateName: "South Carolina", connectorFamily: "sap", platformLabel: "SAP", officialUrl: "https://www.procurement.sc.gov/scpro", status: "planned" },
  { stateCode: "SD", stateName: "South Dakota", connectorFamily: "esm_solutions", platformLabel: "ESM Solutions", officialUrl: "https://boa.sd.gov/central-services/procurement-management/procurement-management-eprocurement.aspx", status: "planned" },
  { stateCode: "TN", stateName: "Tennessee", connectorFamily: "oracle_peoplesoft", platformLabel: "Edison / PeopleSoft by Oracle", officialUrl: "https://hub.edison.tn.gov/psp/paprd/SUPPLIER/SUPP/h/?tab=PAPP_GUEST", status: "live", notes: "Direct official CPO/solicitation feed live." },
  { stateCode: "TX", stateName: "Texas", connectorFamily: "oracle_peoplesoft", platformLabel: "PeopleSoft by Oracle", officialUrl: "https://www.txsmartbuy.com/", status: "planned" },
  { stateCode: "UT", stateName: "Utah", connectorFamily: "jaggaer", platformLabel: "Jaggaer", officialUrl: "https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=StateOfUtah", status: "planned" },
  { stateCode: "VT", stateName: "Vermont", connectorFamily: "ivalua", platformLabel: "Ivalua; PeopleSoft by Oracle", officialUrl: "https://bgs.vermont.gov/content/vtbuys-eprocurement-0", status: "planned" },
  { stateCode: "VA", stateName: "Virginia", connectorFamily: "eva_custom", platformLabel: "eVA", officialUrl: "https://eva.virginia.gov/", status: "planned" },
  { stateCode: "WA", stateName: "Washington", connectorFamily: "webs_custom", platformLabel: "WEBS", officialUrl: "https://des.wa.gov/sell/how-work-state", status: "planned" },
  { stateCode: "WV", stateName: "West Virginia", connectorFamily: "cgi_advantage", platformLabel: "Advantage by CGI", officialUrl: "http://www.wvoasis.gov/", status: "planned" },
  { stateCode: "WI", stateName: "Wisconsin", connectorFamily: "oracle_peoplesoft", platformLabel: "PeopleSoft by Oracle", officialUrl: "https://esupplier.wi.gov/psp/esupplier/SUPPLIER/ERP/h/?tab=WI_BIDDER", status: "planned" },
  { stateCode: "WY", stateName: "Wyoming", connectorFamily: "public_purchase", platformLabel: "Public Purchase", officialUrl: "https://www.publicpurchase.com/gems/browse/home", status: "planned" },
];

export const STATE_CONNECTOR_PRIORITY: StateConnectorFamily[] = [
  "oracle_peoplesoft",
  "jaggaer",
  "periscope_buyspeed",
  "cgi_advantage",
  "ivalua",
  "sap_ariba",
  "sap",
  "proactis_webprocure",
  "direct_state_board",
  "socrata_open_data",
  "public_purchase",
  "infor_luma",
  "infor",
  "esm_solutions",
  "eva_custom",
  "webs_custom",
  "custom",
  "unknown_erp",
];

export function summarizeStateCoverage() {
  const byStatus = STATE_PROCUREMENT_REGISTRY.reduce<Record<StateCoverageStatus, number>>(
    (acc, state) => { acc[state.status] += 1; return acc; },
    { live: 0, partial: 0, blocked: 0, planned: 0 },
  );

  const byFamily = STATE_PROCUREMENT_REGISTRY.reduce<Record<string, string[]>>((acc, state) => {
    (acc[state.connectorFamily] ||= []).push(state.stateCode);
    return acc;
  }, {});

  return { totalStates: STATE_PROCUREMENT_REGISTRY.length, byStatus, byFamily };
}
