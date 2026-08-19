import type { IonWavePortal } from "@/lib/sled/ionwave";

export const VERIFIED_K12_IONWAVE_PORTALS: IonWavePortal[] = [
  { key: "plano_isd_tx", agencyName: "Plano Independent School District", baseUrl: "https://pisd.ionwave.net", stateCode: "TX", city: "Plano", county: "Collin" },
  { key: "lewisville_isd_tx", agencyName: "Lewisville Independent School District", baseUrl: "https://lisd.ionwave.net", stateCode: "TX", city: "Lewisville", county: "Denton" },
  { key: "houston_isd_tx", agencyName: "Houston Independent School District", baseUrl: "https://houstonisd.ionwave.net", stateCode: "TX", city: "Houston", county: "Harris" },
  { key: "duncanville_isd_tx", agencyName: "Duncanville Independent School District", baseUrl: "https://duncanvilleisd.ionwave.net", stateCode: "TX", city: "Duncanville", county: "Dallas" },
  { key: "aledo_isd_tx", agencyName: "Aledo Independent School District", baseUrl: "https://aledoisd.ionwave.net", stateCode: "TX", city: "Aledo", county: "Parker" },
];
