export const disciplines = [
  "Access Control",
  "Video Surveillance",
  "Intrusion",
  "Fire Alarm",
  "Structured Cabling / Fiber",
  "Intercom / Mass Notification",
  "AV",
  "Nurse Call",
  "DAS",
] as const;

export type Discipline = (typeof disciplines)[number];
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type Signal = {
  id: string;
  organization: string;
  location: string;
  discipline: Discipline;
  trigger: string;
  evidence: string;
  estimatedValue: number;
  buyingWindow: string;
  confidence: Confidence;
  score: number;
};

export type Pursuit = {
  id: string;
  organization: string;
  title: string;
  location: string;
  disciplines: Discipline[];
  dueDate: string;
  estimatedValue: number;
  fit: number;
  incumbent?: string;
  specified?: string[];
  engineer?: string;
  preBid?: string;
  documents: number;
};

export type Rebid = {
  id: string;
  organization: string;
  title: string;
  location: string;
  incumbent: string;
  contractValue: number;
  currentEnd: string;
  procurementWindow: string;
  probability: number;
  disciplines: Discipline[];
};

export type Incumbent = {
  contractor: string;
  identifiedValue: number;
  contracts: number;
  markets: string[];
  technologies: string[];
};

export type SpecRecord = {
  manufacturer: string;
  product?: string;
  activeProjects: number;
  preRfpProjects: number;
  estimatedProjectValue: number;
  momentum: number;
  pairedWith: string[];
};

export const signals: Signal[] = [
  { id: "SIG-1048", organization: "Lake County Schools", location: "Illinois", discipline: "Access Control", trigger: "Board capital plan approved", evidence: "District capital plan includes phased electronic access replacement across 18 campuses.", estimatedValue: 4200000, buyingWindow: "3–9 months", confidence: "HIGH", score: 94 },
  { id: "SIG-1047", organization: "Mercy Regional Medical Center", location: "Missouri", discipline: "Nurse Call", trigger: "Expansion enters design", evidence: "New patient tower design package references nurse call, RTLS and low-voltage coordination.", estimatedValue: 3100000, buyingWindow: "6–12 months", confidence: "HIGH", score: 91 },
  { id: "SIG-1046", organization: "City of Mesa", location: "Arizona", discipline: "Video Surveillance", trigger: "Security assessment funded", evidence: "Council approved funding for municipal security assessment and camera modernization planning.", estimatedValue: 1800000, buyingWindow: "4–10 months", confidence: "MEDIUM", score: 86 },
  { id: "SIG-1045", organization: "North Valley University", location: "California", discipline: "DAS", trigger: "Arena renovation approved", evidence: "Arena modernization budget includes public safety radio and cellular coverage improvements.", estimatedValue: 2400000, buyingWindow: "6–14 months", confidence: "MEDIUM", score: 82 },
  { id: "SIG-1044", organization: "Jefferson County", location: "Colorado", discipline: "Fire Alarm", trigger: "Facilities budget allocation", evidence: "Facilities program allocates replacement funding for obsolete life-safety systems in county buildings.", estimatedValue: 1250000, buyingWindow: "2–8 months", confidence: "HIGH", score: 89 },
];

export const pursuits: Pursuit[] = [
  { id: "PUR-231", organization: "DuPage County School District 88", title: "Districtwide Security Modernization", location: "Illinois", disciplines: ["Access Control", "Video Surveillance", "Structured Cabling / Fiber"], dueDate: "Oct 14", estimatedValue: 1800000, fit: 87, incumbent: "Convergint", specified: ["Genetec", "Axis", "Mercury"], engineer: "IMEG", preBid: "Required", documents: 14 },
  { id: "PUR-229", organization: "St. Catherine Health", title: "West Campus Fire Alarm Replacement", location: "Indiana", disciplines: ["Fire Alarm"], dueDate: "Sep 29", estimatedValue: 960000, fit: 92, incumbent: "Johnson Controls", specified: ["Simplex"], engineer: "WSP", preBid: "Required", documents: 9 },
  { id: "PUR-227", organization: "City of Tulsa", title: "Municipal Fiber and Camera Expansion", location: "Oklahoma", disciplines: ["Structured Cabling / Fiber", "Video Surveillance"], dueDate: "Oct 21", estimatedValue: 2750000, fit: 83, specified: ["Axis", "CommScope"], engineer: "Burns & McDonnell", preBid: "Optional", documents: 18 },
  { id: "PUR-225", organization: "Maricopa Community Colleges", title: "Emergency Communications Upgrade", location: "Arizona", disciplines: ["Intercom / Mass Notification", "AV"], dueDate: "Nov 03", estimatedValue: 1420000, fit: 79, incumbent: "AVI-SPL", specified: ["AtlasIED", "Q-SYS"], documents: 11 },
];

export const rebids: Rebid[] = [
  { id: "REB-091", organization: "Cook County", title: "Countywide Security Systems Service", location: "Illinois", incumbent: "Convergint", contractValue: 2700000, currentEnd: "Mar 2027", procurementWindow: "0–9 months", probability: 88, disciplines: ["Access Control", "Video Surveillance", "Intrusion"] },
  { id: "REB-087", organization: "Kansas City Public Schools", title: "Fire Alarm Inspection and Service", location: "Missouri", incumbent: "Johnson Controls", contractValue: 1900000, currentEnd: "Jun 2027", procurementWindow: "3–12 months", probability: 81, disciplines: ["Fire Alarm"] },
  { id: "REB-084", organization: "University of Nevada", title: "Structured Cabling Services", location: "Nevada", incumbent: "IES Communications", contractValue: 3600000, currentEnd: "Aug 2027", procurementWindow: "6–15 months", probability: 76, disciplines: ["Structured Cabling / Fiber"] },
  { id: "REB-079", organization: "Harris County Health", title: "Video Surveillance Maintenance", location: "Texas", incumbent: "Securitas Technology", contractValue: 2200000, currentEnd: "Jan 2027", procurementWindow: "0–6 months", probability: 93, disciplines: ["Video Surveillance"] },
];

export const incumbents: Incumbent[] = [
  { contractor: "Convergint", identifiedValue: 84200000, contracts: 43, markets: ["K-12", "County", "Healthcare"], technologies: ["Genetec", "Axis", "LenelS2", "Mercury"] },
  { contractor: "Johnson Controls", identifiedValue: 61700000, contracts: 37, markets: ["Healthcare", "Higher Ed", "Municipal"], technologies: ["Simplex", "Tyco", "Software House"] },
  { contractor: "Securitas Technology", identifiedValue: 44800000, contracts: 29, markets: ["County", "Municipal", "Higher Ed"], technologies: ["Genetec", "Milestone", "Axis"] },
  { contractor: "IES Communications", identifiedValue: 31900000, contracts: 24, markets: ["Higher Ed", "Healthcare", "State"], technologies: ["CommScope", "Corning", "Panduit"] },
  { contractor: "AVI-SPL", identifiedValue: 26300000, contracts: 19, markets: ["Higher Ed", "State", "Municipal"], technologies: ["Q-SYS", "Crestron", "Biamp"] },
];

export const specs: SpecRecord[] = [
  { manufacturer: "Genetec", activeProjects: 327, preRfpProjects: 89, estimatedProjectValue: 412000000, momentum: 18, pairedWith: ["Axis", "Mercury", "HID"] },
  { manufacturer: "Axis", activeProjects: 301, preRfpProjects: 74, estimatedProjectValue: 361000000, momentum: 15, pairedWith: ["Genetec", "Milestone", "CommScope"] },
  { manufacturer: "Mercury", product: "LP4502", activeProjects: 188, preRfpProjects: 53, estimatedProjectValue: 249000000, momentum: 11, pairedWith: ["Genetec", "LenelS2", "HID"] },
  { manufacturer: "Verkada", activeProjects: 141, preRfpProjects: 47, estimatedProjectValue: 173000000, momentum: 27, pairedWith: ["Meraki", "Schlage", "Allegion"] },
  { manufacturer: "Q-SYS", activeProjects: 119, preRfpProjects: 31, estimatedProjectValue: 128000000, momentum: 21, pairedWith: ["Shure", "Biamp", "Sennheiser"] },
];

export function money(value: number) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toLocaleString()}`;
}
