import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const OCR_BATCH_SIZE = 25;

type OcrJob = {
  job_id: string;
  id: string;
};

export async function GET(request: NextRequest) {
  const unauthorized = requireInternalAuth(request);
  if (unauthorized) return unauthorized;
  const sql = getSql();

  await sql.query(`
    update document_jobs
    set state=case when attempts>=max_attempts then 'dead' else 'pending' end,
        run_after=now(),leased_until=null,lease_owner=null,
        last_error=coalesce(last_error,'ocr lease expired'),updated_at=now()
    where stage='ocr' and state='leased' and leased_until<now()
  `);

  const rows = await sql.query(`
    with claim as (
      select j.id
      from document_jobs j
      join opportunity_documents d on d.id=j.document_id
      join opportunities o on o.id=d.opportunity_id
      where j.stage='ocr' and j.state='pending' and j.run_after<=now()
        and d.extraction_status='text_empty' and d.storage_key is not null
        and lower(coalesce(o.status,'')) in ('open','active','posted')
        and (o.due_at is null or o.due_at>=now())
      order by j.priority,j.run_after,j.id
      limit ${OCR_BATCH_SIZE}
      for update skip locked
    ), moved as (
      update document_jobs j
      set state='done',leased_until=null,lease_owner=null,
          last_error='external_ocr_required_serverless_disabled',updated_at=now()
      from claim where j.id=claim.id
      returning j.id as job_id,j.document_id
    )
    select moved.job_id::text,d.id
    from moved join opportunity_documents d on d.id=moved.document_id
  `) as OcrJob[];

  if (rows.length) {
    await sql.query(`
      update opportunity_documents d
      set extraction_status='external_processing_required'
      from document_jobs j
      where j.document_id=d.id
        and j.stage='ocr'
        and j.state='done'
        and j.last_error='external_ocr_required_serverless_disabled'
        and d.extraction_status='text_empty'
    `);
  }

  return NextResponse.json({
    ok: true,
    processed: rows.length,
    externalProcessingRequired: rows.length,
    message: rows.length
      ? 'Image-only PDFs were quarantined from the unstable serverless OCR lane for external processing.'
      : 'No OCR jobs are waiting.'
  });
}
