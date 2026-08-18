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

function collectFacts(lines: string[]): EvidenceFact[] {
  const facts: EvidenceFact[] = [];
  const seen = new Set<string>();

  const rules: Array<{ factType: string; pattern: RegExp; group?: number }> = [
    { factType: "solicitation_number", pattern: /(?:solicitation|contract)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,})/i },
    { factType: "amendment_number", pattern: /amendment\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9-]+)/i },
    { factType: "naics_code", pattern: /\bNAICS\b[^0-9]{0,24}(\d{6})\b/i },
    { factType: "set_aside", pattern: /\b(set[- ]aside|small business|8\(a\)|HUBZone|service[- ]disabled veteran[- ]owned|SDVOSB|women[- ]owned|WOSB)\b/i, group: 1 },
    { factType: "response_deadline", pattern: /(?:response|offer|proposal|quote|quotation|bid)s?[^\n]{0,50}(?:due|deadline|close|closing)[^\n]{0,80}/i, group: 0 },
    { factType: "submission_instruction", pattern: /(?:submit|submission|offerors? shall submit|quotes? shall be submitted|proposals? shall be submitted)[^\n]{0,180}/i, group: 0 },
    { factType: "evaluation_criteria", pattern: /(?:evaluation criteria|basis for award|award will be made|lowest price technically acceptable|best value)[^\n]{0,180}/i, group: 0 },
  ];

  lines.forEach((rawLine, index) => {
    const line = compact(rawLine);
    if (!line) return;

    for (const rule of rules) {
      const match = line.match(rule.pattern);
      if (!match) continue;
      const value = compact(match[rule.group ?? 1] ?? match[0]);
      const key = `${rule.factType}:${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({ factType: rule.factType, value, sourceText: line, line: index + 1 });
    }
  });

  return facts.slice(0, 30);
}

function collectRequirements(lines: string[]): EvidenceRequirement[] {
  const requirements: EvidenceRequirement[] = [];
  const seen = new Set<string>();

  lines.forEach((rawLine, index) => {
    const line = compact(rawLine);
    if (line.length < 20 || line.length > 500) return;
    if (!/\b(shall|must|required|is required to|are required to)\b/i.test(line)) return;

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
           0.95
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
           0.95
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
