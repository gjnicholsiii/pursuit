import type { SledOpportunityRecord } from "@/lib/sled/types";
import { classifyLowVoltage } from "@/lib/lv-classifier";

const API_BASE = "https://api.procurement.opengov.com/api/v1";
const PAGE_LIMIT = 100;

interface GovernmentEntry {
  id: number;
  name: string;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  countryCode?: string | null;
  isActive?: boolean;
  isVendor?: boolean;
  government?: { code?: string | null; hasSourcing?: boolean } | null;
}

interface ProjectRecord {
  id: number;
  financialId?: string | null;
  title?: string | null;
  status?: string | null;
  type?: string | null;
  departmentName?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  postedAt?: string | null;
  releaseProjectDate?: string | null;
  proposalDeadline?: string | null;
  preProposalDate?: string | null;
  qaDeadline?: string | null;
  comingSoon?: boolean;
  isPaused?: boolean;
  isPrivate?: boolean;
  isLibrary?: boolean;
  isTemplate?: boolean;
  isIntake?: boolean;
  isEvaluationOnly?: boolean;
  isPostOnly?: boolean;
  hasSealedBid?: boolean;
  contact?: Record<string, unknown> | null;
  procurementContact?: Record<string, unknown> | null;
}

function agencyType(name: string) {
  const text = name.toLowerCase();
  if (/school district|public schools|unified school|school system|schools\b|isd\b/.test(text)) return "k12";
  if (/university|community college|\bcollege\b/.test(text)) return "higher_ed";
  if (/\bcounty\b/.test(text)) return "county";
  if (/\bcity of\b|\btown of\b|\bvillage of\b|\bborough of\b/.test(text)) return "municipal";
  if (/airport|transit|port|water|utility|authority|district/.test(text)) return "authority";
  return "public_agency";
}

async function fetchDirectory() {
  const response = await fetch(`${API_BASE}/government`, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`OpenGov directory returned ${response.status}`);
  const payload = await response.json() as GovernmentEntry[];
  return payload.filter(item => item.isActive !== false && item.isVendor !== true && item.countryCode === "US" && item.government?.code);
}

async function fetchProjects(code: string) {
  const all: ProjectRecord[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await fetch(`${API_BASE}/project/list`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ governmentCode: code, publicView: true, limit: PAGE_LIMIT, page }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`OpenGov ${code} returned ${response.status}`);
    const payload = await response.json() as { projects?: ProjectRecord[]; count?: number };
    const projects = Array.isArray(payload.projects) ? payload.projects : [];
    all.push(...projects);
    const count = typeof payload.count === "number" ? payload.count : null;
    if (!projects.length || projects.length < PAGE_LIMIT || (count !== null && all.length >= count)) break;
  }
  return all;
}

function usable(project: ProjectRecord) {
  return Boolean(project.id && project.title?.trim() && !project.isPrivate && !project.isLibrary && !project.isTemplate && !project.isIntake);
}

function earlyProject(project: ProjectRecord) {
  const status = (project.status || "").toLowerCase();
  if (project.comingSoon) return true;
  if (["draft", "planned", "planning", "coming soon", "pre-release", "prerelease"].includes(status)) return true;
  if (project.releaseProjectDate) {
    const release = new Date(project.releaseProjectDate).getTime();
    if (Number.isFinite(release) && release > Date.now()) return true;
  }
  return false;
}

function currentProject(project: ProjectRecord) {
  const status = (project.status || "").toLowerCase();
  if (["closed", "awarded", "cancelled", "canceled", "evaluation"].includes(status)) return false;
  if (project.proposalDeadline) {
    const due = new Date(project.proposalDeadline).getTime();
    if (Number.isFinite(due) && due < Date.now()) return false;
  }
  return true;
}

function mapOpportunity(government: GovernmentEntry, project: ProjectRecord): SledOpportunityRecord {
  const code = government.government?.code || String(government.id);
  const isEarly = earlyProject(project);
  return {
    externalId: `opengov:${code}:${project.id}`,
    agency: {
      key: `opengov:${code}`,
      name: government.name,
      agencyType: agencyType(government.name),
      jurisdictionLevel: "local",
      stateCode: government.state || null,
      city: government.city || null,
      website: government.website || null,
    },
    title: project.title?.trim() || "Untitled OpenGov project",
    description: project.departmentName ? `Department: ${project.departmentName}` : null,
    solicitationType: project.type || project.status || null,
    procurementMechanism: "OpenGov public procurement",
    status: currentProject(project) ? "open" : "closed",
    issueDate: project.postedAt || project.releaseProjectDate || project.created_at || null,
    dueAt: isEarly ? null : project.proposalDeadline || null,
    prebidAt: project.preProposalDate || null,
    stateCode: government.state || null,
    city: government.city || null,
    sourceUrl: `https://procurement.opengov.com/portal/${code}/projects/${project.id}/document`,
    rawPayload: {
      platform: "OpenGov",
      comingSoon: Boolean(project.comingSoon),
      earlyProject: isEarly,
      project,
      government: { id: government.id, code, name: government.name },
    },
  };
}

export async function discoverOpenGovLVBatch(offset = 0, portalLimit = 20) {
  const directory = await fetchDirectory();
  const start = Math.max(0, offset);
  const batch = directory.slice(start, start + Math.max(1, Math.min(50, portalLimit)));
  const pursuits: Array<{ opportunity: SledOpportunityRecord; classification: ReturnType<typeof classifyLowVoltage> }> = [];
  const signals: Array<{ opportunity: SledOpportunityRecord; classification: ReturnType<typeof classifyLowVoltage> }> = [];
  const failures: Array<{ agency: string; error: string }> = [];
  let projectsScanned = 0;

  for (const government of batch) {
    const code = government.government?.code || String(government.id);
    try {
      const projects = await fetchProjects(code);
      projectsScanned += projects.length;
      for (const project of projects.filter(usable)) {
        const opportunity = mapOpportunity(government, project);
        if (opportunity.status !== "open") continue;
        const classification = classifyLowVoltage({ title: opportunity.title, description: opportunity.description });
        if (!classification.accepted) continue;
        if (earlyProject(project)) signals.push({ opportunity, classification });
        else pursuits.push({ opportunity, classification });
      }
    } catch (error) {
      failures.push({ agency: government.name, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    directorySize: directory.length,
    offset: start,
    processed: batch.length,
    projectsScanned,
    nextOffset: start + batch.length < directory.length ? start + batch.length : null,
    pursuits,
    signals,
    failures,
  };
}
