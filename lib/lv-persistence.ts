import { neon } from "@neondatabase/serverless";
import type { SledOpportunityRecord } from "@/lib/sled/types";
import type { LVClassification } from "@/lib/lv-classifier";

function db() {
  const url = process.env.LOW_VOLTAGE_DATABASE_URL;
  return url ? neon(url) : null;
}

export function lowVoltageDatabaseConfigured() {
  return Boolean(process.env.LOW_VOLTAGE_DATABASE_URL);
}

export async function persistLVPursuit(opportunity: SledOpportunityRecord, classification: LVClassification) {
  const sql = db();
  if (!sql) return { stored: false, reason: "LOW_VOLTAGE_DATABASE_URL not configured" };

  const orgRows = await sql`
    insert into organizations (organization_name, organization_type, city, state, website)
    values (${opportunity.agency.name}, ${opportunity.agency.agencyType}, ${opportunity.city || null}, ${opportunity.stateCode || null}, ${opportunity.agency.website || null})
    returning id
  `;
  const organizationId = Number(orgRows[0].id);

  const projectRows = await sql`
    insert into projects (organization_id, project_title, location_text, project_stage, estimated_value, expected_procurement_start, expected_procurement_end)
    values (${organizationId}, ${opportunity.title}, ${[opportunity.city, opportunity.stateCode].filter(Boolean).join(", ") || null}, 'solicitation', ${opportunity.estimatedValue || null}, ${opportunity.issueDate || null}, ${opportunity.dueAt ? opportunity.dueAt.slice(0, 10) : null})
    returning id
  `;
  const projectId = Number(projectRows[0].id);

  for (const match of classification.disciplines) {
    await sql`
      insert into project_disciplines (project_id, discipline, confidence)
      values (${projectId}, ${match.discipline}, ${match.score})
      on conflict (project_id, discipline) do update set confidence = excluded.confidence
    `;
  }

  await sql`
    insert into pursuits (project_id, solicitation_number, due_at, fit_score, source_url, status)
    values (${projectId}, ${opportunity.externalId}, ${opportunity.dueAt || null}, ${classification.score}, ${opportunity.sourceUrl}, ${opportunity.status})
  `;

  return { stored: true, projectId };
}
