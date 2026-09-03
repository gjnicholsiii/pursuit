import { neon } from "@neondatabase/serverless";
import type { SpecMention } from "@/lib/lv-spec-extractor";

type Row = Record<string, unknown>;
function rows(value: unknown) { return value as Row[]; }

export async function persistSpecMentions(input: {
  projectId: number;
  evidenceId: number;
  mentions: SpecMention[];
  specifyingFirm?: string | null;
}) {
  const url = process.env.LOW_VOLTAGE_DATABASE_URL;
  if (!url) return { stored: 0, reason: "LOW_VOLTAGE_DATABASE_URL not configured" };
  const sql = neon(url);

  const validProject = rows(await sql`select id from projects where id = ${input.projectId} limit 1`);
  const validEvidence = rows(await sql`select id from source_evidence where id = ${input.evidenceId} limit 1`);
  if (!validProject.length || !validEvidence.length) return { stored: 0, reason: "project_or_evidence_not_found" };

  let stored = 0;
  for (const mention of input.mentions) {
    const duplicate = rows(await sql`
      select id from spec_mentions
      where project_id = ${input.projectId}
        and evidence_id = ${input.evidenceId}
        and manufacturer = ${mention.manufacturer}
        and coalesce(product, '') = ${mention.product || ""}
        and mention_text = ${mention.excerpt}
      limit 1
    `);
    if (duplicate.length) continue;

    await sql`
      insert into spec_mentions (project_id, evidence_id, manufacturer, product, discipline, specifying_firm, mention_text)
      values (${input.projectId}, ${input.evidenceId}, ${mention.manufacturer}, ${mention.product}, ${mention.discipline}, ${input.specifyingFirm || null}, ${mention.excerpt})
    `;
    stored += 1;
  }

  return { stored };
}
