export type SignalEvidenceType =
  | "capital_plan"
  | "board_approval"
  | "budget_allocation"
  | "bond_program"
  | "security_assessment"
  | "consultant_selection"
  | "design_document"
  | "grant_award"
  | "facility_expansion"
  | "code_compliance"
  | "planning_mention";

const BASE: Record<SignalEvidenceType, number> = {
  capital_plan: 64,
  board_approval: 78,
  budget_allocation: 82,
  bond_program: 72,
  security_assessment: 76,
  consultant_selection: 84,
  design_document: 91,
  grant_award: 80,
  facility_expansion: 68,
  code_compliance: 74,
  planning_mention: 46,
};

const SOURCE_QUALITY: Record<string, number> = {
  official_board_record: 12,
  adopted_budget: 12,
  capital_improvement_plan: 11,
  official_project_page: 10,
  official_agenda: 9,
  official_minutes: 9,
  architect_engineer_page: 8,
  grant_database: 8,
  press_release: 5,
  news_report: 2,
  other: 0,
};

export type SignalScoreInput = {
  evidenceType: SignalEvidenceType;
  sourceQuality?: keyof typeof SOURCE_QUALITY | string;
  ageDays?: number | null;
  lowVoltageSpecificity?: number;
  valueKnown?: boolean;
  buyingWindowKnown?: boolean;
  multipleIndependentSources?: boolean;
};

export function scoreSignal(input: SignalScoreInput) {
  let score = BASE[input.evidenceType];
  score += SOURCE_QUALITY[input.sourceQuality || "other"] || 0;

  const specificity = Math.max(0, Math.min(100, input.lowVoltageSpecificity ?? 50));
  score += Math.round((specificity - 50) * 0.18);

  if (input.valueKnown) score += 4;
  if (input.buyingWindowKnown) score += 4;
  if (input.multipleIndependentSources) score += 6;

  if (typeof input.ageDays === "number") {
    if (input.ageDays <= 30) score += 5;
    else if (input.ageDays <= 90) score += 2;
    else if (input.ageDays > 365) score -= 12;
    else if (input.ageDays > 180) score -= 5;
  }

  score = Math.max(0, Math.min(100, score));
  const confidence = score >= 80 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW";

  return {
    score,
    confidence,
    rationale: {
      evidenceBase: BASE[input.evidenceType],
      sourceQuality: SOURCE_QUALITY[input.sourceQuality || "other"] || 0,
      lowVoltageSpecificity: specificity,
      valueKnown: Boolean(input.valueKnown),
      buyingWindowKnown: Boolean(input.buyingWindowKnown),
      multipleIndependentSources: Boolean(input.multipleIndependentSources),
      ageDays: input.ageDays ?? null,
    },
  };
}
