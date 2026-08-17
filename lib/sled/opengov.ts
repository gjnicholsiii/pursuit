import { getSql } from "@/lib/db";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledAgencyRecord, SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

const API_BASE = "https://api.procurement.opengov.com/api/v1";
const PAGE_LIMIT = 100;
const CONCURRENCY = 8;

const SOURCE: SledSourceConfig = {
  adapterKey: "opengov_public",
  sourceName: "OpenGov Public Procurement Network",
  baseUrl: "https://procurement.opengov.com",
  jurisdiction: "United States",
  sourceType: "portal",
};

interface OpenGovDirectoryEntry {
  id: number;
  name: string;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  countryCode?: string | null;
  isActive?: boolean;
  isVendor?: boolean;
  government?: {
    code?: string | null;
    hasSourcing?: boolean;
  } | null;
}

interface OpenGovProject {
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
  user?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
  procurementContact?: Record<string, unknown> | null;
  template?: Record<string, unknown> | null;
  [key: string]: unknown;
}

interface OpenGovProjectListResponse {
  projects?: OpenGovProject[];
  count?: number;
}

export interface OpenGovSyncResult {
  governmentsDiscovered: number;
  portalsAttempted: number;
  portalsSucceeded: number;
  portalsFailed: number;
  projectsSeen: number;
  stored: number;
  newRecords: number;
  changedRecords: number;
  openRecords: number;
  failures: Array<{ code: string; name: string; error: string }>;
  startedAt: string;
  completedAt: string;
  bootstrap: boolean;
}

function inferAgencyType(name: string) {
  const value = name.toLowerCase();
  if (/school district|public schools|unified school|school system|schools\b|isd\b/.test(value)) return "k12";
  if (/university|community college|\bcollege\b|higher education/.test(value)) return "higher_ed";
  if (/state of |state government|department of .*state/.test(value)) return "state_agency";
  if (/\bcounty\b/.test(value)) return "county";
  if (/\bcity of\b|\btown of\b|\bvillage of\b|\bborough of\b/.test(value)) return "municipal";
  if (/airport|transit|transportation authority|port authority|water|utility|authority|district/.test(value)) return "authority";
  return "local_agency";
}

function jurisdictionLevel(agencyType: string) {
  if (agencyType === "state_agency") return "state";
  if (agencyType === "k12" || agencyType === "higher_ed") return "education";
  return "local";
}

function toAgency(entry: OpenGovDirectoryEntry): SledAgencyRecord {
  const code = entry.government?.code || String(entry.id);
  const agencyType = inferAgencyType(entry.name);
  return {
    key: `opengov:${code}`,
    name: entry.name,
    agencyType,
    jurisdictionLevel: jurisdictionLevel(agencyType),
    stateCode: entry.state || null,
    city: entry.city || null,
    website: entry.website || null,
  };
}

function isProjectUsable(project: OpenGovProject) {
  return Boolean(
    project.id &&
    project.title?.trim() &&
    !project.isPrivate &&
    !project.isLibrary &&
    !project.isTemplate &&
    !project.isIntake
  );
}

function pursuitStatus(project: OpenGovProject): "open" | "closed" {
  const deadline = project.proposalDeadline ? new Date(project.proposalDeadline) : null;
  if (deadline && !Number.isNaN(deadline.getTime())) return deadline.getTime() >= Date.now() ? "open" : "closed";
  if (project.comingSoon) return "open";
  const status = (project.status || "").toLowerCase();
  if (["closed", "evaluation", "awarded", "cancelled", "canceled"].includes(status)) return "closed";
  return "open";
}

function mapProject(entry: OpenGovDirectoryEntry, project: OpenGovProject): SledOpportunityRecord {
  const code = entry.government?.code || String(entry.id);
  const agency = toAgency(entry);
  return {
    externalId: `${code}:${project.id}`,
    agency,
    title: project.title?.trim() || "Untitled OpenGov opportunity",
    description: project.departmentName ? `Department: ${project.departmentName}` : null,
    solicitationType: project.template && typeof project.template.title === "string"
      ? project.template.title
      : project.type || null,
    procurementMechanism: project.type || null,
    status: pursuitStatus(project),
    issueDate: project.postedAt || project.releaseProjectDate || project.created_at || null,
    dueAt: project.proposalDeadline || null,
    prebidAt: project.preProposalDate || null,
    stateCode: entry.state || null,
    city: entry.city || null,
    sourceUrl: `https://procurement.opengov.com/portal/${code}/projects/${project.id}/document`,
    rawPayload: {
      platform: "OpenGov",
      governmentCode: code,
      government: entry,
      project,
    },
  };
}

async function fetchDirectory() {
  const response = await fetch(`${API_BASE}/government`, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`OpenGov government directory returned ${response.status}`);
  const payload = await response.json() as OpenGovDirectoryEntry[];
  return payload.filter(entry =>
    entry.isActive !== false &&
    entry.isVendor !== true &&
    entry.countryCode === "US" &&
    Boolean(entry.government?.code)
  );
}

async function fetchPortalProjects(code: string) {
  const all: OpenGovProject[] = [];
  let page = 1;
  while (page <= 100) {
    const response = await fetch(`${API_BASE}/project/list`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ governmentCode: code, publicView: true, limit: PAGE_LIMIT, page }),
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenGov ${code} returned ${response.status}: ${body.slice(0, 180)}`);
    }
    const payload = await response.json() as OpenGovProjectListResponse;
    const projects = Array.isArray(payload.projects) ? payload.projects : [];
    all.push(...projects);
    const count = typeof payload.count === "number" ? payload.count : null;
    if (!projects.length || projects.length < PAGE_LIMIT || (count !== null && all.length >= count)) break;
    page += 1;
  }
  return all;
}

async function closeMissingOpenGovRecords(syncStartedAt: string) {
  const sql = getSql();
  await sql.query(
    `update opportunities o
     set status='closed'
     from sources s
     where o.source_id=s.id
       and s.adapter_key='opengov_public'
       and o.status='open'
       and o.last_seen_at < $1::timestamptz`,
    [syncStartedAt],
  );
}

export async function syncOpenGovPublic(bootstrap = false): Promise<OpenGovSyncResult> {
  const startedAt = new Date().toISOString();
  const directory = await fetchDirectory();
  const failures: Array<{ code: string; name: string; error: string }> = [];
  let nextIndex = 0;
  let portalsSucceeded = 0;
  let projectsSeen = 0;
  let stored = 0;
  let newRecords = 0;
  let changedRecords = 0;
  let openRecords = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= directory.length) return;
      const government = directory[index];
      const code = government.government?.code || String(government.id);
      try {
        const projects = await fetchPortalProjects(code);
        const mapped = projects.filter(isProjectUsable).map(project => mapProject(government, project));
        projectsSeen += mapped.length;
        openRecords += mapped.filter(item => item.status === "open").length;
        for (let offset = 0; offset < mapped.length; offset += 300) {
          const result = await persistSledOpportunities(SOURCE, mapped.slice(offset, offset + 300), {
            mode: bootstrap ? "opengov_bootstrap" : "opengov_daily",
            recordChanges: !bootstrap,
          });
          stored += result.stored;
          newRecords += result.newRecords;
          changedRecords += result.changedRecords;
        }
        portalsSucceeded += 1;
      } catch (error) {
        failures.push({
          code,
          name: government.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  if (!failures.length) await closeMissingOpenGovRecords(startedAt);

  return {
    governmentsDiscovered: directory.length,
    portalsAttempted: directory.length,
    portalsSucceeded,
    portalsFailed: failures.length,
    projectsSeen,
    stored,
    newRecords,
    changedRecords,
    openRecords,
    failures: failures.slice(0, 25),
    startedAt,
    completedAt: new Date().toISOString(),
    bootstrap,
  };
}
