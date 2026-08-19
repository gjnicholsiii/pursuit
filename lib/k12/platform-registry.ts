export type K12PlatformStatus = "classified" | "connector_live" | "blocked" | "needs_review";

export interface K12PlatformRecord {
  stateCode: string;
  districtName: string;
  procurementPlatform: string;
  procurementUrl: string;
  scope: string;
  status: K12PlatformStatus;
  notes?: string;
}

export const K12_PLATFORM_REGISTRY: K12PlatformRecord[] = [
  {
    stateCode: "FL",
    districtName: "Miami-Dade County Public Schools",
    procurementPlatform: "DemandStar",
    procurementUrl: "https://procurement.dadeschools.net/appx/default.asp",
    scope: "non-construction solicitations",
    status: "classified",
    notes: "District procurement site states that M-DCPS partners with Onvia DemandStar for publishing and managing competitive non-construction solicitations; district site remains an additional publication surface.",
  },
  {
    stateCode: "FL",
    districtName: "Broward County Public Schools",
    procurementPlatform: "DemandStar",
    procurementUrl: "https://www.browardschools.com/bcps-departments/procurement/district-bid-opportunities-demandstar",
    scope: "current solicitations and addenda",
    status: "classified",
    notes: "District states all current solicitation/bid opportunities and addenda are posted through DemandStar Onvia, with electronic bid receipt through DemandStar.",
  },
  {
    stateCode: "FL",
    districtName: "Orange County Public Schools",
    procurementPlatform: "VendorLink",
    procurementUrl: "https://www.ocps.net/procurement-services-solicitations",
    scope: "goods and services solicitations and award notifications",
    status: "classified",
    notes: "OCPS states VendorLink is used for solicitation notifications, solicitation documents, and award notifications. Facilities and construction contracting has additional district pages and should be treated as a separate coverage lane.",
  },
];
