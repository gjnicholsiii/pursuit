import { getSql } from "@/lib/db";

export interface OpportunityDocumentSummary {
  identified: number;
  fetched: number;
  analyzed: number;
  missing: number;
  packageStatus: string | null;
  packageNote: string | null;
  packageCheckedAt: string | null;
  documents: Array<{
    id: string;
    filename: string;
    sourceUrl: string;
    extractionStatus: string;
    fetchedAt: string | null;
  }>;
  requirements: Array<{
    id: string;
    category: string;
    requirementText: string;
    sourceText: string;
    line: number | null;
    filename: string;
    sourceUrl: string;
    confidence: number | null;
  }>;
}

type DocumentRow = {
  id: string;
  filename: string;
  source_url: string;
  storage_key: string | null;
  extraction_status: string;
  fetched_at: string | null;
  is_missing: boolean;
};

type RequirementRow = {
  id: string;
  category: string;
  requirement_text: string;
  extraction_confidence: number | string | null;
  evidence_locator: { line?: number } | null;
  document_id: string;
  filename: string;
  source_url: string;
  storage_key: string | null;
};

type PackageRow = {
  package_status: string | null;
  package_note: string | null;
  package_checked_at: string | null;
};

export async function getOpportunityDocumentSummary(opportunityId: string): Promise<OpportunityDocumentSummary> {
  const sql = getSql();

  const [rawRows, rawRequirementRows, packageRows] = await Promise.all([
    sql.query(
      `select id, filename, source_url, storage_key, extraction_status, fetched_at, is_missing
       from opportunity_documents
       where opportunity_id=$1
       order by fetched_at desc nulls last, filename asc`,
      [opportunityId],
    ),
    sql.query(
      `select r.id, r.category, r.requirement_text, r.extraction_confidence, r.evidence_locator,
              d.id as document_id, d.filename, d.source_url, d.storage_key
       from requirements r
       join opportunity_documents d on d.id=r.document_id
       where r.opportunity_id=$1 and r.mandatory=true
       order by r.created_at asc, r.id asc`,
      [opportunityId],
    ),
    sql.query(
      `select raw_payload->>'pursuitPackageStatus' as package_status,
              raw_payload->>'pursuitPackageNote' as package_note,
              raw_payload->>'pursuitPackageCheckedAt' as package_checked_at
       from opportunities where id=$1 limit 1`,
      [opportunityId],
    ),
  ]);

  const rows = rawRows as unknown as DocumentRow[];
  const requirementRows = rawRequirementRows as unknown as RequirementRow[];
  const packageRow = (packageRows as unknown as PackageRow[])[0];

  return {
    identified: rows.length,
    fetched: rows.filter(row => Boolean(row.fetched_at)).length,
    analyzed: rows.filter(row => ["complete", "extracted", "analyzed"].includes(row.extraction_status)).length,
    missing: rows.filter(row => row.is_missing).length,
    packageStatus: packageRow?.package_status || null,
    packageNote: packageRow?.package_note || null,
    packageCheckedAt: packageRow?.package_checked_at || null,
    documents: rows.slice(0, 50).map(row => ({
      id: row.id,
      filename: row.filename,
      sourceUrl: row.storage_key ? `/api/documents/file/${row.id}` : row.source_url,
      extractionStatus: row.extraction_status,
      fetchedAt: row.fetched_at,
    })),
    requirements: requirementRows.slice(0, 20).map(row => ({
      id: row.id,
      category: row.category,
      requirementText: row.requirement_text,
      sourceText: row.requirement_text,
      line: typeof row.evidence_locator?.line === "number" ? row.evidence_locator.line : null,
      filename: row.filename,
      sourceUrl: row.storage_key ? `/api/documents/file/${row.document_id}` : row.source_url,
      confidence: row.extraction_confidence == null ? null : Number(row.extraction_confidence),
    })),
  };
}
