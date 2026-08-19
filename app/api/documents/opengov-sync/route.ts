import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const API_BASE = "https://api.procurement.opengov.com/api/v1";
const BATCH_SIZE = 100;

type OppRow = {
  id: string;
  source_url: string;
  project_id: string;
  government_code: string;
  agency_type: string;
};

type Attachment = {
  url?: string;
  filename?: string;
  path?: string;
  id?: number;
  title?: string;
  name?: string;
  type?: string;
  fileExtension?: string;
};

type Criterion = {
  id?: number;
  title?: string | null;
  description?: string | null;
  isHiddenByLogic?: boolean;
};

type Questionnaire = {
  id?: number;
  title?: string | null;
  prompt?: string | null;
  isRequired?: boolean;
  type?: string;
  attachments?: Attachment[];
};

type ProjectDetail = {
  id?: number;
  title?: string;
  attachments?: Attachment[];
  criteria?: Criterion[];
  questionnaires?: Questionnaire[];
  evaluationPhases?: Array<{
    scoringCriteria?: Array<{ id?: number; title?: string; description?: string; weight?: number }>;
  }>;
};

function textFromHtml(value: string | null | undefined) {
  if (!value) return "";
  return cheerio.load(value).text().replace(/\s+/g, " ").trim();
}

function categoryFor(text: string) {
  if (/insurance|insured|liability|workers.? compensation/i.test(text)) return "insurance";
  if (/bond|bonding/i.test(text)) return "bonding";
  if (/certif|affidavit|registration|disclosure|questionnaire/i.test(text)) return "certification";
  if (/price|pricing|fee|cost/i.test(text)) return "pricing";
  if (/evaluation|award|score|weight/i.test(text)) return "evaluation";
  if (/scope|technical|training|specification|service/i.test(text)) return "technical";
  if (/submit|submission|proposal|bid package|return with/i.test(text)) return "submission_requirement";
  return "other_requirement";
}

function looksRequired(text: string) {
  return /\b(shall|must|required|submit|failure to|will be cause|shall provide|shall include)\b/i.test(text);
}

function attachmentKey(a: Attachment) {
  return a.path || (a.id ? `attachment:${a.id}` : a.url || a.filename || "");
}

export async function GET() {
  const sql = getSql();
  const opportunities = await sql.query(
    `select o.id,
            o.source_url,
            o.raw_payload->'project'->>'id' as project_id,
            o.raw_payload->'government'->>'code' as government_code,
            a.agency_type
     from opportunities o
     join agencies a on a.id=o.agency_id
     join sources s on s.id=o.source_id
     where s.adapter_key='opengov_public'
       and o.status='open'
       and (o.due_at is null or o.due_at >= now())
       and o.raw_payload->'project'->>'id' is not null
       and o.raw_payload->>'_pursuitDocumentSyncAt' is null
     order by case when a.agency_type='k12' then 0 when a.agency_type='higher_ed' then 1 else 2 end,
              o.due_at asc nulls last,
              o.id
     limit ${BATCH_SIZE}`,
  ) as OppRow[];

  let attachmentsRegistered = 0;
  let requirementsRegistered = 0;
  let evaluationFactsRegistered = 0;
  const processed: Array<Record<string, unknown>> = [];

  for (const opp of opportunities) {
    try {
      const response = await fetch(`${API_BASE}/project/${opp.project_id}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        processed.push({ opportunityId: opp.id, status: response.status, error: "OpenGov project detail failed" });
        continue;
      }

      const detail = await response.json() as ProjectDetail;
      const attachments = new Map<string, Attachment>();
      for (const a of detail.attachments || []) if (a.url && attachmentKey(a)) attachments.set(attachmentKey(a), a);
      for (const q of detail.questionnaires || []) {
        for (const a of q.attachments || []) if (a.url && attachmentKey(a)) attachments.set(attachmentKey(a), a);
      }

      for (const a of attachments.values()) {
        const filename = a.filename || a.name || a.title || `opengov-${a.id || "document"}.${a.fileExtension || "bin"}`;
        const result = await sql.query(
          `insert into opportunity_documents
             (opportunity_id, document_type, filename, source_url, referenced_by, extraction_status)
           select $1::uuid, 'opengov_attachment', $2::text, $3::text, 'OpenGov project API', 'pending'
           where not exists (
             select 1 from opportunity_documents
             where opportunity_id=$1::uuid
               and document_type='opengov_attachment'
               and (filename=$2::text or source_url=$3::text)
           )
           returning id`,
          [opp.id, filename, a.url],
        ) as Array<{id:string}>;
        attachmentsRegistered += result.length;
      }

      for (const criterion of detail.criteria || []) {
        if (criterion.isHiddenByLogic) continue;
        const body = textFromHtml(criterion.description);
        const title = textFromHtml(criterion.title || "");
        const evidence = [title, body].filter(Boolean).join(": ");
        if (!evidence || !looksRequired(evidence)) continue;
        const result = await sql.query(
          `insert into requirements
             (opportunity_id, document_id, category, requirement_text, mandatory, evidence_locator, normalized_value, extraction_confidence)
           select $1::uuid, null, $2::text, $3::text, true,
                  jsonb_build_object('source','OpenGov project API','project_id',$4::text,'criterion_id',$5::text,'source_url',$6::text),
                  jsonb_build_object('source','opengov_api'), 0.99
           where not exists (
             select 1 from requirements
             where opportunity_id=$1::uuid and requirement_text=$3::text
           )
           returning id`,
          [opp.id, categoryFor(evidence), evidence, opp.project_id, String(criterion.id || ""), opp.source_url],
        ) as Array<{id:string}>;
        requirementsRegistered += result.length;
      }

      for (const q of detail.questionnaires || []) {
        if (!q.isRequired) continue;
        const prompt = textFromHtml(q.prompt);
        const evidence = [q.title || "Required response item", prompt].filter(Boolean).join(": ");
        const result = await sql.query(
          `insert into requirements
             (opportunity_id, document_id, category, requirement_text, mandatory, evidence_locator, normalized_value, extraction_confidence)
           select $1::uuid, null, $2::text, $3::text, true,
                  jsonb_build_object('source','OpenGov project API','project_id',$4::text,'questionnaire_id',$5::text,'source_url',$6::text),
                  jsonb_build_object('source','opengov_api','response_type',$7::text), 0.99
           where not exists (
             select 1 from requirements
             where opportunity_id=$1::uuid and requirement_text=$3::text
           )
           returning id`,
          [opp.id, categoryFor(evidence), evidence, opp.project_id, String(q.id || ""), opp.source_url, q.type || "unknown"],
        ) as Array<{id:string}>;
        requirementsRegistered += result.length;
      }

      for (const phase of detail.evaluationPhases || []) {
        for (const item of phase.scoringCriteria || []) {
          const description = textFromHtml(item.description);
          const value = `${item.title || "Evaluation criterion"}${typeof item.weight === "number" ? ` — ${item.weight}%` : ""}${description ? `: ${description}` : ""}`;
          const result = await sql.query(
            `insert into extracted_facts
               (opportunity_id, document_id, fact_type, normalized_value, source_text, evidence_locator, extraction_confidence)
             select $1::uuid, null, 'evaluation_criteria',
                    jsonb_build_object('value',$2::text,'weight',$3::numeric), $2::text,
                    jsonb_build_object('source','OpenGov project API','project_id',$4::text,'scoring_criterion_id',$5::text,'source_url',$6::text), 0.99
             where not exists (
               select 1 from extracted_facts
               where opportunity_id=$1::uuid and fact_type='evaluation_criteria' and source_text=$2::text
             )
             returning id`,
            [opp.id, value, typeof item.weight === "number" ? item.weight : null, opp.project_id, String(item.id || ""), opp.source_url],
          ) as Array<{id:string}>;
          evaluationFactsRegistered += result.length;
        }
      }

      await sql.query(
        `update opportunities
         set raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object('_pursuitDocumentSyncAt', now()::text)
         where id=$1::uuid`,
        [opp.id],
      );

      processed.push({
        opportunityId: opp.id,
        agencyType: opp.agency_type,
        projectId: opp.project_id,
        attachments: attachments.size,
      });
    } catch (error) {
      processed.push({ opportunityId: opp.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return NextResponse.json({
    ok: true,
    opportunitiesProcessed: processed.length,
    attachmentsRegistered,
    requirementsRegistered,
    evaluationFactsRegistered,
    processed,
  });
}
