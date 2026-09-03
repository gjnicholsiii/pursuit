import { neon } from "@neondatabase/serverless";
import type { SledOpportunityRecord } from "@/lib/sled/types";
import type { LVClassification } from "@/lib/lv-classifier";
import { scoreSignal, type SignalEvidenceType } from "@/lib/lv-signal-score";

type Row = Record<string, unknown>;
type SqlClient = any;

function rows(value: unknown) {
  return value as Row[];
}

function db() {
  const url = process.env.LOW_VOLTAGE_DATABASE_URL;
  return url ? neon(url) : null;
}

export function lowVoltageDatabaseConfigured() {
  return Boolean(process.env.LOW_VOLTAGE_DATABASE_URL);
}

async function ensureOrganization(sql: SqlClient, opportunity: SledOpportunityRecord) {
  const existing = rows(await sql`
    select id from organizations
    where organization_name = ${opportunity.agency.name}
      and coalesce(state, '') = ${opportunity.stateCode || ""}
    order by id asc
    limit 1
  `);
  if (existing.length) return Number(existing[0].id);

  const inserted = rows(await sql`
    insert into organizations (organization_name, organization_type, city, state, website)
    values (${opportunity.agency.name}, ${opportunity.agency.agencyType}, ${opportunity.city || null}, ${opportunity.stateCode || null}, ${opportunity.agency.website || null})
    returning id
  `);
  return Number(inserted[0].id);
}

async function addDisciplines(sql: SqlClient, projectId: number, classification: LVClassification) {
  for (const match of classification.disciplines) {
    await sql`
      insert into project_disciplines (project_id, discipline, confidence)
      values (${projectId}, ${match.discipline}, ${match.score})
      on conflict (project_id, discipline) do update set confidence = excluded.confidence
    `;
  }
}

export async function persistLVPursuit(opportunity: SledOpportunityRecord, classification: LVClassification) {
  const sql = db();
  if (!sql) return { stored: false, reason: "LOW_VOLTAGE_DATABASE_URL not configured" };

  const existing = rows(await sql`
    select id, project_id from pursuits
    where solicitation_number = ${opportunity.externalId} and source_url = ${opportunity.sourceUrl}
    limit 1
  `);
  if (existing.length) return { stored: false, reason: "already_exists", projectId: Number(existing[0].project_id) };

  const organizationId = await ensureOrganization(sql, opportunity);
  const projectRows = rows(await sql`
    insert into projects (organization_id, project_title, location_text, project_stage, estimated_value, expected_procurement_start, expected_procurement_end)
    values (${organizationId}, ${opportunity.title}, ${[opportunity.city, opportunity.stateCode].filter(Boolean).join(", ") || null}, 'solicitation', ${opportunity.estimatedValue || null}, ${opportunity.issueDate ? opportunity.issueDate.slice(0, 10) : null}, ${opportunity.dueAt ? opportunity.dueAt.slice(0, 10) : null})
    returning id
  `);
  const projectId = Number(projectRows[0].id);
  await addDisciplines(sql, projectId, classification);

  await sql`
    insert into pursuits (project_id, solicitation_number, due_at, fit_score, source_url, status)
    values (${projectId}, ${opportunity.externalId}, ${opportunity.dueAt || null}, ${classification.score}, ${opportunity.sourceUrl}, ${opportunity.status})
  `;

  return { stored: true, projectId };
}

function ageDays(value?: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.floor((Date.now() - time) / 86_400_000)) : null;
}

export async function persistLVSignal(
  opportunity: SledOpportunityRecord,
  classification: LVClassification,
  evidenceType: SignalEvidenceType = "planning_mention",
) {
  const sql = db();
  if (!sql) return { stored: false, reason: "LOW_VOLTAGE_DATABASE_URL not configured" };

  const existing = rows(await sql`
    select s.id, s.project_id
    from signals s
    join source_evidence e on e.id = s.evidence_id
    where e.source_url = ${opportunity.sourceUrl}
      and e.content_hash = ${opportunity.externalId}
    limit 1
  `);
  if (existing.length) return { stored: false, reason: "already_exists", projectId: Number(existing[0].project_id) };

  const organizationId = await ensureOrganization(sql, opportunity);
  const projectRows = rows(await sql`
    insert into projects (organization_id, project_title, location_text, project_stage, estimated_value, expected_procurement_start, expected_procurement_end)
    values (${organizationId}, ${opportunity.title}, ${[opportunity.city, opportunity.stateCode].filter(Boolean).join(", ") || null}, 'pre_rfp', ${opportunity.estimatedValue || null}, ${opportunity.issueDate ? opportunity.issueDate.slice(0, 10) : null}, ${opportunity.dueAt ? opportunity.dueAt.slice(0, 10) : null})
    returning id
  `);
  const projectId = Number(projectRows[0].id);
  await addDisciplines(sql, projectId, classification);

  const evidenceRows = rows(await sql`
    insert into source_evidence (source_type, source_title, source_url, publisher, published_at, excerpt, content_hash)
    values ('public_project_page', ${opportunity.title}, ${opportunity.sourceUrl}, ${opportunity.agency.name}, ${opportunity.issueDate || null}, ${opportunity.description || opportunity.title}, ${opportunity.externalId})
    on conflict (source_url, content_hash) do update set retrieved_at = now()
    returning id
  `);
  const evidenceId = Number(evidenceRows[0].id);

  const scoring = scoreSignal({
    evidenceType,
    sourceQuality: "official_project_page",
    ageDays: ageDays(opportunity.issueDate),
    lowVoltageSpecificity: classification.score,
    valueKnown: Boolean(opportunity.estimatedValue),
    buyingWindowKnown: Boolean(opportunity.issueDate || opportunity.dueAt),
  });

  await sql`
    insert into signals (project_id, evidence_id, trigger_type, trigger_summary, score, confidence, buying_window)
    values (${projectId}, ${evidenceId}, ${evidenceType}, ${opportunity.title}, ${scoring.score}, ${scoring.confidence}, 'Pre-release')
  `;

  return { stored: true, projectId, evidenceId, signalScore: scoring.score };
}
