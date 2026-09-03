import type { SledOpportunityRecord } from "@/lib/sled/types";
import { classifyLowVoltage } from "@/lib/lv-classifier";

const API_BASE = "https://api.procurement.opengov.com/api/v1";

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
  postedAt?: string | null;
  releaseProjectDate?: string | null;
  proposalDeadline?: string | null;
  preProposalDate?: string | null;
  comingSoon?: boolean;
  isPrivate?: boolean;
  isLibrary?: boolean;
  isTemplate?: boolean;
  isIntake?: boolean;
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
  const response = await fetch(`${API_BASE}/project/list`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ governmentCode: code, publicView: true, limit: 100, page: 1 }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`OpenGov ${code} returned ${response.status}`);
  const payload = await response.json() as { projects?: ProjectRecord[] };
  return Array.isArray(payload.projects) ? payload.projects : [];
}

function usable(project: ProjectRecord) {
  return Boolean(project.id && project.title?.trim() && !project.isPrivate && !project.isLibrary && !project.isTemplate && !project.isIntake);
}

function mapOpportunity(government: GovernmentEntry, project: ProjectRecord): SledOpportunityRecord {
  const code = government.government?.code || String(government.id);
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
    solicitationType: project.type || null,
    procurementMechanism: project.type || null,
    status: project.comingSoon ? "open" : (project.proposalDeadline && new Date(project.proposalDeadline).getTime() < Date.now() ? "closed" : "open"),
    issueDate: project.postedAt || project.releaseProjectDate || project.created_at || null,
    dueAt: project.proposalDeadline || null,
    prebidAt: project.preProposalDate || null,
    stateCode: government.state || null,
    city: government.city || null,
    sourceUrl: `https://procurement.opengov.com/portal/${code}/projects/${project.id}/document`,
    rawPayload: { platform: "OpenGov", comingSoon: Boolean(project.comingSoon), project, government: { id: government.id, code, name: government.name } },
  };
}

export async function discoverOpenGovLVBatch(offset = 0, portalLimit = 20) {
  const directory = await fetchDirectory();
  const batch = directory.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, Math.min(50, portalLimit)));
  const pursuits: Array<{ opportunity: SledOpportunityRecord; classification: ReturnType<typeof classifyLowVoltage> }> = [];
  const signals: Array<{ opportunity: SledOpportunityRecord; classification: ReturnType<typeof classifyLowVoltage> }> = [];
  const failures: Array<{ agency: string; error: string }> = [];

  for (const government of batch) {
    const code = government.government?.code || String(government.id);
    try {
      const projects = await fetchProjects(code);
      for (const project of projects.filter(usable)) {
        const opportunity = mapOpportunity(government, project);
        const classification = classifyLowVoltage({ title: opportunity.title, description: opportunity.description });
        if (!classification.accepted) continue;
        if (project.comingSoon) signals.push({ opportunity, classification });
        else if (opportunity.status === "open") pursuits.push({ opportunity, classification });
      }
    } catch (error) {
      failures.push({ agency: government.name, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    directorySize: directory.length,
    offset,
    processed: batch.length,
    nextOffset: offset + batch.length < directory.length ? offset + batch.length : null,
    pursuits,
    signals,
    failures,
  };
}
