import { Opportunity, PathToAward, ReadinessItem } from "./types";

export const readiness: ReadinessItem[] = [
  { label: "SAM registration", status: "verified", detail: "Active through May 2027" },
  { label: "UEI", status: "verified", detail: "Verified" },
  { label: "CAGE", status: "verified", detail: "Active" },
  { label: "NAICS", status: "review", detail: "3 likely additions found" },
  { label: "Small business", status: "verified", detail: "Eligible" },
  { label: "Contract vehicles", status: "missing", detail: "None connected" },
];

export const opportunities: Opportunity[] = [
  {
    id: "opp-001",
    agency: "Department of the Army",
    title: "Physical Security Equipment and Installation",
    location: "Fort Campbell, KY",
    value: 248000,
    due: "Sep 04",
    confidence: 97,
    eligibility: "ready",
    procurementPath: "Simplified Acquisition",
    stage: "new",
    source: "SAM.gov + solicitation package",
    tags: ["Federal", "Small Business", "RFQ"],
    verified: ["No contract vehicle identified", "Small-business set-aside", "Submission path confirmed", "All 6 attachments acquired"],
    nextStep: "Review the RFQ and confirm technical compliance before pricing."
  },
  {
    id: "opp-002",
    agency: "Jefferson County Public Schools",
    title: "District Facility Technology Improvements",
    location: "Louisville, KY",
    value: 615000,
    due: "Sep 11",
    confidence: 91,
    eligibility: "ready",
    procurementPath: "Competitive Sealed Bid",
    stage: "review",
    source: "District procurement portal",
    tags: ["K-12", "SLED", "Formal Bid"],
    verified: ["Bid bond requirement found", "Mandatory prebid status confirmed", "Award basis identified"],
    uncertainty: ["Agency has not published bidder Q&A yet"],
    nextStep: "Decide whether the bonding and response burden fit your business."
  },
  {
    id: "opp-003",
    agency: "City of Cincinnati",
    title: "Technology Maintenance and Support Services",
    location: "Cincinnati, OH",
    value: 185000,
    due: "Aug 29",
    confidence: 86,
    eligibility: "review",
    procurementPath: "Request for Quotes",
    stage: "new",
    source: "Municipal procurement portal",
    tags: ["Local", "RFQ", "Services"],
    verified: ["No bid bond", "No mandatory walkthrough", "Three-quote procurement"],
    uncertainty: ["Historical award value unavailable", "Insurance exhibit references an unpublished schedule"],
    nextStep: "Confirm insurance limits with procurement before committing response time."
  },
  {
    id: "opp-004",
    agency: "Department of Veterans Affairs",
    title: "Facility Systems Preventive Maintenance",
    location: "Great Lakes Region",
    value: 920000,
    due: "Sep 18",
    confidence: 63,
    eligibility: "blocked",
    procurementPath: "Task Order / Existing Vehicle",
    stage: "new",
    source: "SAM.gov",
    tags: ["Federal", "Services", "Vehicle Required"],
    verified: ["Scope identified", "Due date confirmed"],
    uncertainty: ["Two referenced attachments unavailable", "Vehicle eligibility not established", "Pricing schedule missing"],
    blocker: "An eligible contract vehicle appears to be required.",
    nextStep: "Resolve vehicle eligibility and obtain the missing pricing attachment."
  }
];

export const pathToAward: PathToAward = {
  id: "path-001",
  agency: "Department of the Army",
  opportunity: "Physical Security Equipment and Installation",
  mechanism: "Simplified Acquisition",
  explanation: "This procurement is being run under simplified acquisition procedures. The solicitation does not identify a GSA Schedule or other contract vehicle as a prerequisite.",
  steps: [
    "Confirm the company meets the stated small-business and NAICS requirements.",
    "Review technical requirements and every amendment.",
    "Complete the RFQ pricing and required representations.",
    "Submit through the method stated in the solicitation before the deadline."
  ],
  doesNotRequire: ["GSA Schedule", "Prime contract history", "Large federal proposal team"]
};
