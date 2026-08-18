import { getSql } from "@/lib/db";

export interface OpportunityDocumentSummary {
  identified: number;
  fetched: number;
  analyzed: number;
  missing: number;
  documents: Array<{
    id: string;
    filename: string;
    sourceUrl: string;
    extractionStatus: string;
    fetchedAt: string | null;
  }>;
}

export async function getOpportunityDocumentSummary(opportunityId: string): Promise<OpportunityDocumentSummary> {
  const sql = getSql();
  const rows = await sql.query(
    `select
       id,
       filename,
       source_url,
       extraction_status,
       fetched_at,
       is_missing
     from opportunity_documents
     where opportunity_id = $1
     order by fetched_at desc nulls last, filename asc`,
    [opportunityId],
  ) as Array<{
    id: string;
    filename: string;
    source_url: string;
    extraction_status: string;
    fetched_at: string | null;
    is_missing: boolean;
  }>;

  return {
    identified: rows.length,
    fetched: rows.filter(row => Boolean(row.fetched_at)).length,
    analyzed: rows.filter(row => ["complete", "extracted", "analyzed"].includes(row.extraction_status)).length,
    missing: rows.filter(row => row.is_missing).length,
    documents: rows.slice(0, 12).map(row => ({
      id: row.id,
      filename: row.filename,
      sourceUrl: row.source_url,
      extractionStatus: row.extraction_status,
      fetchedAt: row.fetched_at,
    })),
  };
}
