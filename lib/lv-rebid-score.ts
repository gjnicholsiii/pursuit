const DAY = 86_400_000;

export type RebidInput = {
  currentEndDate?: string | null;
  renewalOptionsRemaining?: number | null;
  originalTermMonths?: number | null;
  awardDate?: string | null;
  contractValue?: number | null;
  priorRecompeteCadenceMonths?: number | null;
  budgetStillActive?: boolean;
  incumbentStillActive?: boolean;
  replacementSignal?: boolean;
  cancellationSignal?: boolean;
};

function daysUntil(value?: string | null) {
  if (!value) return null;
  const time = new Date(`${value.slice(0, 10)}T12:00:00Z`).getTime();
  return Number.isFinite(time) ? Math.round((time - Date.now()) / DAY) : null;
}

export function scoreRebid(input: RebidInput) {
  const days = daysUntil(input.currentEndDate);
  let score = 25;
  const reasons: string[] = [];

  if (days !== null) {
    if (days < -90) { score -= 20; reasons.push("current term appears materially expired"); }
    else if (days <= 90) { score += 36; reasons.push("current end date is inside 90 days"); }
    else if (days <= 180) { score += 31; reasons.push("current end date is inside six months"); }
    else if (days <= 365) { score += 24; reasons.push("current end date is inside twelve months"); }
    else if (days <= 540) { score += 14; reasons.push("current end date is inside eighteen months"); }
    else { score += 4; reasons.push("contract remains outside near-term positioning window"); }
  }

  if (input.renewalOptionsRemaining === 0) { score += 18; reasons.push("no renewal options remain"); }
  else if (typeof input.renewalOptionsRemaining === "number" && input.renewalOptionsRemaining > 1) { score -= 8; reasons.push("multiple renewal options remain"); }

  if ((input.contractValue || 0) >= 1_000_000) { score += 5; reasons.push("material contract value increases procurement visibility"); }
  if (input.budgetStillActive) { score += 7; reasons.push("owner budget still supports the function"); }
  if (input.incumbentStillActive) { score += 3; reasons.push("incumbent relationship appears active"); }
  if (input.replacementSignal) { score += 16; reasons.push("replacement or modernization evidence detected"); }
  if (input.cancellationSignal) { score -= 35; reasons.push("cancellation or discontinuation evidence detected"); }

  if (input.priorRecompeteCadenceMonths && input.originalTermMonths) {
    const delta = Math.abs(input.priorRecompeteCadenceMonths - input.originalTermMonths);
    if (delta <= 6) { score += 7; reasons.push("historical buying cadence aligns with current term"); }
  }

  score = Math.max(0, Math.min(100, score));
  const band = score >= 80 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW";
  const procurementWindow = days === null ? "UNKNOWN" : days <= 120 ? "0–6 months" : days <= 270 ? "3–9 months" : days <= 450 ? "6–15 months" : "12+ months";

  return { score, band, daysToCurrentEnd: days, procurementWindow, reasons };
}
