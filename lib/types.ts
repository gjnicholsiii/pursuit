export type OpportunityStage = "new" | "review" | "pursuit" | "submitted" | "watch" | "walk";
export type EligibilityStatus = "ready" | "review" | "blocked";

export interface Opportunity {
  id: string;
  agency: string;
  title: string;
  location: string;
  value: number;
  due: string;
  confidence: number;
  eligibility: EligibilityStatus;
  procurementPath: string;
  stage: OpportunityStage;
  source: string;
  tags: string[];
  verified: string[];
  uncertainty?: string[];
  blocker?: string;
  nextStep: string;
}

export interface ReadinessItem {
  label: string;
  status: "verified" | "missing" | "review";
  detail: string;
}

export interface PathToAward {
  id: string;
  agency: string;
  opportunity: string;
  mechanism: string;
  explanation: string;
  steps: string[];
  doesNotRequire: string[];
}
