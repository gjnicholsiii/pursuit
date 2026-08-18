import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ExtractedDocumentRow {
  id: string;
  opportunity_id: string;
  filename: string;
  text_storage_key: string;
}

interface EvidenceFact {
  factType: string;
  value: string;
  sourceText: string;
  line: number;
}

interface EvidenceRequirement {
  category: string;
  text: string;
  sourceText: string;
  line: number;
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeProcurementIdentifier(value: string) {
  const candidate = value.trim().toUpperCase();
  if (candidate.length < 7 || candidate.length > 40) return false;
  if (!/[0-9]/.test(candidate)) return false;
  if (!/[A-Z]/.test(candidate)) return false;
  if (!/^[A-Z0-9][A-Z0-9-]+$/.test(candidate)) return false;
  return true;
}

function collectFacts(lines: string[]): EvidenceFact[] {
  const facts: EvidenceFact[] = [];
  const seen = new Set<string>();

  const add = (factType: string, value: string, sourceText: string, line: number) => {
    const cleaned = compact(value);
    if (!cleaned) return;
    const key = `${factType}:${cleaned.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({ factType, value: cleaned, sourceText, line });
  };

  lines.forEach((rawLine, index) => {
    const line = compact(rawLine);
    if (!line) return;

    const solicitationMatch = line.match(/\b(?:solicitation|contract)\s+(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{6,39})\b/i);
    if (solicitationMatch && looksLikeProcurementIdentifier(solicitationMatch[1])) {
      add("solicitation_number", solicitationMatch[1], line, index + 1);
    }

    const amendmentMatch = line.match(/\bamendment\s+(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{0,12})\b/i);
    if (amendmentMatch && /\d/.test(amendmentMatch[1])) {
      add("amendment_number", amendmentMatch[1], line, index + 1);
    }

    const naicsMatch = line.match(/\bNAICS\b[^0-9]{0,24}(\d{6})\b/i);
    if (naicsMatch) add("naics_code", naicsMatch[1], line, index + 1);

    const setAsideMatch = line.match(/\b(8\(a\)|HUBZone|SDVOSB|WOSB|service[- ]disabled veteran[- ]owned small business|women[- ]owned small business|small business set[- ]aside|total small business set[- ]aside)\b/i);
    if (setAsideMatch) add("set_aside", setAsideMatch[1], line, index + 1);

    if (/\b(?:response|offer|proposal|quote|quotation|bid)s?\b/i.test(line) && /\b(?:due|deadline|closing|close date)\b/i.test(line)) {
      add("response_deadline", line, line, index + 1);
    }

    if (/\b(?:offerors? shall submit|quotes? shall be submitted|proposals? shall be submitted|submit (?:offers?|quotes?|proposals?))\b/i.test(line)) {
      add("submission_instruction", line, line, index + 1);
    }

    if (/\b(?:evaluation criteria|basis for award|award will be made|lowest price technically acceptable|best value)\b/i.test(line)) {
      add("evaluation_criteria", line, line, index + 1);
    }
  });

  return facts.slice(0, 30);
}

function collectRequirements(lines: string[]): EvidenceRequirement[] {
  const requirements: EvidenceRequirement[] = [];
  const seen = new Set<string>();

  lines.forEach((rawLine, index) => {
    const line = compact(rawLine);
    if (line.length < 25 || line.length > 500) return;
    if (!/\b(shall|must|required to|are required to|is required to)\b/i.test(line)) return;
    if (/\bif required\b/i.test(line)) return;
    if (/\bnot\s+(?:is\s+)?required\b/i.test(line)) return;
    if (/\bnot required\b/i.test(line)) return;

    const normalized = line.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);

    let category = "submission_requirement";
    if (/bond|bonding/i.test(line)) category = "bonding";
    else if (/insurance|insured/i.test(line)) category = "insurance";
    else if (/certif|representation/i.test(line)) category = "certification";
    else if (/delivery|deliver|period of performance|performance period/i.test(line)) category = "performance";
    else if (/technical|specification|statement of work|scope of work/i.test(line)) category = "technical";
    else if (/price|pricing|cost/i.test(line)) category = "pricing";

    requirements.push({ category, text: line, sourceText: line, line: index + 1 });
  });

  return requirements.slice(0, 25);
}

export async function GET() {
  const sql = getSql();
  const rows = await sql.query(
    `select
       d.id,
       d.opportunity_id,
       d.filename,
       ef.normalized_value->>'text_storage_key' as text_storage_key
     from opportunity_documents d
     join extracted_facts ef
       on ef.document_id = d.id
      and ef.fact_type = 'document_text_extract'
     join opportunities o on o.id = d.opportunity_id
     join sources s on s.id = o.source_id
     where s.adapter_key = 'sam_gov'
       and d.extraction_status = 'text_extracted'
       and ef.normalized_value->>'text_storage_key' is not null
     order by d.fetched_at asc nulls last, d.id
     limit 1`,
  ) as ExtractedDocumentRow[];

  const document = rows[0];
  if (!document) {
    return NextResponse.json({ ok: true, message: "No extracted SAM PDFs are waiting for evidence analysis" });
  }

  try {
    const blob = await get(document.text_storage_key, { access: "private" });
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json(
        { ok: false, documentId: document.id, error: "Extracted text could not be read from private Blob storage" },
        { status: 502 },
      );
    }

    const text = await new Response(blob.stream).text();
    const lines = text.split(/\r?\n/);
    const facts = collectFacts(lines);
    const requirements = collectRequirements(lines);

    for (const fact of facts) {
      await sql.query(
        `insert into extracted_facts (
           opportunity_id,
           document_id,
           fact_type,
           normalized_value,
           source_text,
           evidence_locator,
           extraction_confidence
         )
         select
           $1::uuid,
           $2::uuid,
           $3::text,
           jsonb_build_object('value', $4::text),
           $5::text,
           jsonb_build_object('document_id', $2::text, 'line', $6::int),
           0.98
         where not exists (
           select 1
           from extracted_facts existing
           where existing.document_id = $2::uuid
             and existing.fact_type = $3::text
             and existing.source_text = $5::text
         )`,
        [document.opportunity_id, document.id, fact.factType, fact.value, fact.sourceText, fact.line],
      );
    }

    for (const requirement of requirements) {
      await sql.query(
        `insert into requirements (
           opportunity_id,
           document_id,
           category,
           requirement_text,
           mandatory,
           evidence_locator,
           normalized_value,
           extraction_confidence
         )
         select
           $1::uuid,
           $2::uuid,
           $3::text,
           $4::text,
           true,
           jsonb_build_object('document_id', $2::text, 'line', $5::int),
           jsonb_build_object('source', 'document_text'),
           0.98
         where not exists (
           select 1
           from requirements existing
           where existing.document_id = $2::uuid
             and existing.requirement_text = $4::text
         )`,
        [document.opportunity_id, document.id, requirement.category, requirement.text, requirement.line],
      );
    }

    await sql.query(
      `update opportunity_documents
       set extraction_status = 'analyzed'
       where id = $1::uuid`,
      [document.id],
    );

    return NextResponse.json({
      ok: true,
      documentId: document.id,
      opportunityId: document.opportunity_id,
      filename: document.filename,
      factsFound: facts.length,
      requirementsFound: requirements.length,
      extractionStatus: "analyzed",
      facts: facts.map((fact) => ({
        factType: fact.factType,
        value: fact.value,
        sourceText: fact.sourceText,
        line: fact.line,
      })),
      requirements: requirements.map((requirement) => ({
        category: requirement.category,
        requirementText: requirement.text,
        sourceText: requirement.sourceText,
        line: requirement.line,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        documentId: document.id,
        error: error instanceof Error ? error.message : "Evidence analysis failed",
      },
      { status: 502 },
    );
  }
}
