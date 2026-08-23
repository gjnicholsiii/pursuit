import { get, put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { getDocumentProxy } from "unpdf";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STANDARD_DOCUMENT_BYTES = 50 * 1024 * 1024;
const EXTRACTION_BATCH_SIZE = 8;
const MAX_EXTRACTED_CHARACTERS = 12_000_000;
const EXTRACTION_BUDGET_MS = 240_000;

interface FetchedDocumentRow {
  job_id: string;
  id: string;
  opportunity_id: string;
  filename: string;
  storage_key: string;
  host_class: string;
  priority: number;
  bytes: number;
}

async function finishJob(jobId:string){
  const sql=getSql();
  await sql.query(`update document_jobs set state='done',leased_until=null,lease_owner=null,last_error=null,updated_at=now() where id=$1::bigint`,[jobId]);
}

async function retryJob(jobId:string,error:string){
  const sql=getSql();
  await sql.query(`update document_jobs set state=case when attempts>=max_attempts then 'dead' else 'pending' end,run_after=now()+(interval '1 second'*least(600,power(2,attempts))),leased_until=null,lease_owner=null,last_error=$2,updated_at=now() where id=$1::bigint`,[jobId,error.slice(0,1000)]);
}

async function releaseJob(jobId:string){
  const sql=getSql();
  await sql.query(`update document_jobs set state='pending',leased_until=null,lease_owner=null,run_after=now(),updated_at=now() where id=$1::bigint and state='leased'`,[jobId]);
}

async function extractPdfPagewise(pdf:any) {
  const pages:string[]=[];
  let characters=0;
  const totalPages=Number(pdf.numPages||0);
  for(let pageNumber=1;pageNumber<=totalPages;pageNumber++){
    const page=await pdf.getPage(pageNumber);
    try{
      const content=await page.getTextContent();
      const text=(content.items||[]).map((item:any)=>typeof item?.str==="string"?item.str:"").filter(Boolean).join(" ");
      if(text){pages.push(text);characters+=text.length+1;}
      if(characters>=MAX_EXTRACTED_CHARACTERS)break;
    } finally {
      try{page.cleanup?.();}catch{}
    }
  }
  return {text:pages.join("\n"),totalPages,characters,truncated:characters>=MAX_EXTRACTED_CHARACTERS};
}

async function extractOne(document: FetchedDocumentRow) {
  const sql = getSql();
  let pdf:any=null;
  try {
    const blob = await get(document.storage_key, { access:"private" });
    if (!blob || blob.statusCode !== 200 || !blob.stream) throw new Error("stored_pdf_unavailable");

    const bytes = await new Response(blob.stream).arrayBuffer();
    pdf = await getDocumentProxy(new Uint8Array(bytes));
    const extracted = await extractPdfPagewise(pdf);
    const text = extracted.text;

    if (!text.trim()) {
      await sql.query(`update opportunity_documents set extraction_status='text_empty' where id=$1::uuid`, [document.id]);
      await finishJob(document.job_id);
      return { ok:false, documentId:document.id, reason:"text_empty", permanent:true };
    }

    const textPath = `extracted/${document.opportunity_id}/${document.id}.txt`;
    const textBlob = await put(textPath, text, { access:"private", contentType:"text/plain; charset=utf-8", addRandomSuffix:false, allowOverwrite:true });

    await sql.query(
      `insert into extracted_facts (opportunity_id,document_id,fact_type,normalized_value,source_text,evidence_locator,extraction_confidence)
       select $1::uuid,$2::uuid,'document_text_extract',jsonb_build_object('text_storage_key',$3::text,'page_count',$4::int,'character_count',$5::int,'truncated',$6::boolean),null,jsonb_build_object('document_id',$2::text),1.0
       where not exists (select 1 from extracted_facts where document_id=$2::uuid and fact_type='document_text_extract')`,
      [document.opportunity_id,document.id,textBlob.pathname,extracted.totalPages,text.length,extracted.truncated]
    );
    await sql.query(`update opportunity_documents set extraction_status='text_extracted' where id=$1::uuid`, [document.id]);
    await sql.query(`insert into document_jobs(document_id,stage,host_class,priority) values($1::uuid,'analyze',$2,$3) on conflict(document_id,stage) do update set priority=least(document_jobs.priority,excluded.priority),state=case when document_jobs.state in ('done','leased') then document_jobs.state else 'pending' end,updated_at=now()`,[document.id,document.host_class,Math.max(0,document.priority-10)]);
    await finishJob(document.job_id);
    return { ok:true, documentId:document.id, pages:extracted.totalPages, characters:text.length, truncated:extracted.truncated };
  } catch (error) {
    const message=error instanceof Error ? error.message : "text_extraction_failed";
    await retryJob(document.job_id,message);
    return { ok:false, documentId:document.id, reason:message };
  } finally {
    try{await pdf?.destroy?.();}catch{}
    pdf=null;
  }
}

export async function GET(request: NextRequest) {
  const unauthorized=requireInternalAuth(request); if(unauthorized)return unauthorized;
  const sql = getSql();
  await sql.query(`update document_jobs set state=case when attempts>=max_attempts then 'dead' else 'pending' end,run_after=now()+(interval '1 second'*least(600,power(2,attempts))),leased_until=null,lease_owner=null,last_error=coalesce(last_error,'lease expired'),updated_at=now() where state='leased' and leased_until<now()`);
  const owner=`vercel-extract-${crypto.randomUUID()}`;
  const rows = await sql.query(
    `with claim as (
       select j.id from document_jobs j join opportunity_documents d on d.id=j.document_id join opportunities o on o.id=d.opportunity_id
       where j.stage='extract' and j.state='pending' and j.run_after<=now() and d.extraction_status='fetched' and d.storage_key is not null and lower(d.filename) like '%.pdf' and o.status='open' and (o.due_at is null or o.due_at>=now())
       order by j.priority,j.run_after,j.id limit ${EXTRACTION_BATCH_SIZE} for update skip locked
     ), leased as (
       update document_jobs j set state='leased',leased_until=now()+interval '10 minutes',lease_owner=$1,attempts=attempts+1,updated_at=now() from claim where j.id=claim.id returning j.id as job_id,j.document_id,j.host_class,j.priority,j.meta
     )
     select leased.job_id::text,d.id,d.opportunity_id,d.filename,d.storage_key,leased.host_class,leased.priority,coalesce((leased.meta->>'bytes')::bigint,0)::bigint as bytes from leased join opportunity_documents d on d.id=leased.document_id`,[owner]
  ) as FetchedDocumentRow[];

  if (!rows.length) return NextResponse.json({ ok:true, processed:0, message:"No extraction jobs are waiting" });
  const results=[] as Array<Record<string,unknown>>;
  const startedAt=Date.now();
  let processedRows=0;
  for (const document of rows) {
    if (Date.now()-startedAt>=EXTRACTION_BUDGET_MS) break;
    results.push(await extractOne(document));
    processedRows++;
  }
  for (const document of rows.slice(processedRows)) await releaseJob(document.job_id);
  const extracted=results.filter(result=>result.ok).length;
  const oversized=rows.slice(0,processedRows).filter(row=>Number(row.bytes)>STANDARD_DOCUMENT_BYTES).length;
  return NextResponse.json({ ok:true, processed:results.length, extracted, failed:results.length-extracted, oversized, released:rows.length-processedRows });
}