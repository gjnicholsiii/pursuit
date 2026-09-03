import type { Discipline } from "@/lib/low-voltage";

const RULES: Record<Discipline, string[]> = {
  "Access Control": ["access control", "card reader", "badge reader", "electronic access", "door controller", "credential", "hid reader", "mercury controller", "lenels2", "software house", "ccure", "genetec synergy"],
  "Video Surveillance": ["video surveillance", "cctv", "security camera", "camera system", "vms", "video management", "axis camera", "avigilon", "milestone xprotect", "genetec security center"],
  "Intrusion": ["intrusion detection", "burglar alarm", "duress alarm", "panic alarm", "motion detector", "glass break", "intrusion alarm"],
  "Fire Alarm": ["fire alarm", "fire detection", "mass notification fire", "addressable fire", "simplex", "notifier", "edwards est", "firelite", "gamewell"],
  "Structured Cabling / Fiber": ["structured cabling", "low voltage cabling", "data cabling", "fiber optic", "fiber backbone", "cat6", "cat 6", "cat6a", "horizontal cabling", "telecommunications cabling", "inside plant", "outside plant fiber"],
  "Intercom / Mass Notification": ["intercom", "public address", "mass notification", "emergency notification", "paging system", "school intercom", "clock speaker", "atlasied", "valcom"],
  "AV": ["audio visual", "audiovisual", "av system", "video wall", "projection system", "conference room technology", "digital signage", "q-sys", "crestron", "biamp", "extron"],
  "Nurse Call": ["nurse call", "patient communication", "responder 5", "rauland", "hillrom", "ascom nurse", "telligence"],
  "DAS": ["distributed antenna system", "das system", "public safety das", "errcs", "emergency responder radio", "bda system", "bi-directional amplifier", "in-building radio coverage"],
};

const TITLE_ANCHORS: Record<Discipline, string[]> = {
  "Access Control": ["access control", "card reader", "badge reader", "electronic access"],
  "Video Surveillance": ["video surveillance", "cctv", "security camera", "camera system", "video management system"],
  "Intrusion": ["intrusion detection", "burglar alarm", "duress alarm", "panic alarm", "intrusion alarm"],
  "Fire Alarm": ["fire alarm", "fire detection"],
  "Structured Cabling / Fiber": ["structured cabling", "low voltage cabling", "data cabling", "fiber optic", "fiber backbone", "telecommunications cabling"],
  "Intercom / Mass Notification": ["intercom", "public address system", "mass notification", "paging system"],
  "AV": ["audio visual", "audiovisual", "av system", "video wall", "digital signage"],
  "Nurse Call": ["nurse call", "patient communication"],
  "DAS": ["distributed antenna system", "public safety das", "errcs", "emergency responder radio", "bda system", "bi-directional amplifier"],
};

const STRONG_EXCLUSIONS = [
  "traffic signal",
  "traffic camera enforcement",
  "body worn camera",
  "police body camera",
  "computer laptop",
  "desktop computer",
  "software subscription only",
  "fire extinguisher",
  "sprinkler inspection only",
  "electrical switchgear",
  "high voltage",
  "fuel pump",
  "underwater camera",
  "access control point",
  "master electrician",
  "electrical distribution equipment",
];

const MANUFACTURERS: Record<string, string[]> = {
  Genetec: ["genetec", "security center", "synergis"],
  Axis: ["axis communications", "axis camera", "axis network"],
  Mercury: ["mercury security", "lp4502", "lp1502", "mr52"],
  HID: ["hid global", "signo reader", "iclass se"],
  LenelS2: ["lenels2", "onguard"],
  Avigilon: ["avigilon", "unity video", "avigilon alta"],
  Milestone: ["milestone xprotect", "xprotect"],
  Verkada: ["verkada"],
  Simplex: ["simplex", "4100es"],
  Notifier: ["notifier", "nfs2-3030"],
  CommScope: ["commscope", "systimax"],
  Corning: ["corning fiber", "corning optical"],
  Panduit: ["panduit"],
  QSYS: ["q-sys", "qsys"],
  Crestron: ["crestron"],
  Biamp: ["biamp"],
  Rauland: ["rauland", "responder 5"],
  Ascom: ["ascom"],
  AtlasIED: ["atlasied", "atlas ied"],
  Valcom: ["valcom"],
};

export type LVClassification = {
  accepted: boolean;
  score: number;
  disciplines: Array<{ discipline: Discipline; score: number; matchedTerms: string[] }>;
  manufacturers: string[];
  exclusions: string[];
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+\-/ ]+/g, " ").replace(/\s+/g, " ").trim();
}

function termMatches(text: string, terms: string[]) {
  return terms.filter(term => text.includes(term));
}

export function classifyLowVoltage(input: { title?: string | null; description?: string | null; scope?: string | null }): LVClassification {
  const title = normalize(input.title || "");
  const text = normalize([input.title, input.description, input.scope].filter(Boolean).join(" \n "));
  const exclusions = STRONG_EXCLUSIONS.filter(term => text.includes(term));

  const disciplines = (Object.entries(RULES) as Array<[Discipline, string[]]>)
    .map(([discipline, terms]) => {
      const matchedTerms = termMatches(text, terms);
      const titleAnchors = termMatches(title, TITLE_ANCHORS[discipline]);
      const evidenceScore = matchedTerms.reduce((sum, term) => sum + (term.includes(" ") ? 28 : 18), 0);
      const titleScore = titleAnchors.length ? 58 + Math.min(18, (titleAnchors.length - 1) * 9) : 0;
      const score = Math.min(100, Math.max(evidenceScore, titleScore));
      return { discipline, score, matchedTerms };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const manufacturers = Object.entries(MANUFACTURERS)
    .filter(([, terms]) => terms.some(term => text.includes(term)))
    .map(([manufacturer]) => manufacturer);

  const strongest = disciplines[0]?.score || 0;
  const supporting = disciplines.slice(1).reduce((sum, item) => sum + Math.min(15, item.score / 4), 0);
  const manufacturerBoost = Math.min(18, manufacturers.length * 6);
  const exclusionPenalty = exclusions.length * 24;
  const score = Math.max(0, Math.min(100, Math.round(strongest + supporting + manufacturerBoost - exclusionPenalty)));

  return {
    accepted: score >= 45 && disciplines.length > 0,
    score,
    disciplines,
    manufacturers,
    exclusions,
  };
}
