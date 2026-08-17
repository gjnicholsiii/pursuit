export interface SledSourceConfig {
  adapterKey: string;
  sourceName: string;
  baseUrl: string;
  jurisdiction?: string;
  sourceType?: "api" | "licensed_feed" | "portal" | "website" | "document_index";
}

export interface SledAgencyRecord {
  key: string;
  name: string;
  agencyType: string;
  jurisdictionLevel: string;
  stateCode?: string | null;
  city?: string | null;
  county?: string | null;
  website?: string | null;
}

export interface SledOpportunityRecord {
  externalId: string;
  agency: SledAgencyRecord;
  title: string;
  description?: string | null;
  solicitationType?: string | null;
  procurementMechanism?: string | null;
  status: "open" | "closed";
  issueDate?: string | null;
  dueAt?: string | null;
  prebidAt?: string | null;
  estimatedValue?: number | null;
  stateCode?: string | null;
  city?: string | null;
  naicsCodes?: string[];
  setAside?: string | null;
  sourceUrl: string;
  rawPayload: Record<string, unknown>;
}

export interface SledPersistenceResult {
  stored: number;
  newRecords: number;
  changedRecords: number;
  closedRecords: number;
}
