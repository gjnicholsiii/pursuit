import { get, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface FetchedDocumentRow {
  id: string;
  opportunity_id: string;
  filename: string;
  storage_key: string;
}

async function extractOne(document: FetchedDocumentRow) {
  const sql = getSql();
  try {
    const blob = await get(document.storage_key, { access:"private" });
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      await sql.query(`update opportunity_documents set extraction_status='text_fetch_failed' where id=$1::uuid`, [document.id]);
      return { ok:false, documentId:document.id, reason:"stored_pdf_unavailable" };
    }

    const bytes = await new Response(blob.stream).arrayBuffer();
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const extracted = await extractText(pdf, { mergePages:true });
    const text = extracted.text;

    if (!text.trim()) {
      await sql.query(`update opportunity_documents set extraction_status='text_empty' where id=$1::uuid`, [document.id]);
      return { ok:false, documentId:document.id, reason:"text_empty" };
    }

    const textPath = `extracted/${document.opportunity_id}/${document.id}.txt`;
    const textBlob = await put(textPath, text, {
      access:"private",
      contentType:"text/plain; charset=utf-8",
      addRandomSuffix:false,
      allowOverwrite:true,
    });

    await sql.query(
      `insert into extracted_facts (opportunity_id,document_id,fact_type,normalized_value,source_text,evidence_locator,extraction_confidence)
       select $1::uuid,$2::uuid,'document_text_extract',
              jsonb_build_object('text_storage_key',$3::text,'page_count',$4::int,'character_count',$5::int),
              null,jsonb_build_object('document_id',$2::text),1.0
       where not exists (
         select 1 from extracted_facts where document_id=$2::uuid and fact_type='document_text_extract'
       )`,
      [document.opportunity_id,document.id,textBlob.pathname,extracted.totalPages,text.length],
    );

    await sql.query(`update opportunity_documents set extraction_status='text_extracted' where id=$1::uuid`, [document.id]);
    return { ok:true, documentId:document.id, opportunityId:document.opportunity_id, filename:document.filename, pages:extracted.totalPages, characters:text.length };
  } catch (error) {
    await sql.query(`update opportunity_documents set extraction_status='text_failed' where id=$1::uuid`, [document.id]);
    return { ok:false, documentId:document.id, reason:error instanceof Error ? error.message : "text_extraction_failed" };
  }
}

export async function GET() {
  const sql = getSql();
  const rows = await sql.query(
    `select d.id,d.opportunity_id,d.filename,d.storage_key
     from opportunity_documents d
     join opportunities o on o.id=d.opportunity_id
     join sources s on s.id=o.source_id
     join agencies a on a.id=o.agency_id
     where d.extraction_status='fetched'
       and d.storage_key is not null
       and lower(d.filename) like '%.pdf'
       and o.status='open'
       and (o.due_at is null or o.due_at >= now())
     order by case when a.agency_type='k12' then 0 when a.agency_type='higher_ed' then 1 when s.adapter_key='sam_gov' then 2 when s.source_family='sled' then 3 else 4 end,
              d.fetched_at asc nulls last,d.id
     limit 24`,
  ) as FetchedDocumentRow[];

  if (!rows.length) return NextResponse.json({ ok:true, processed:0, message:"No fetched PDFs are waiting for text extraction" });

  const results=[] as Array<Record<string,unknown>>;
  const concurrency=3;
  for(let i=0;i<rows.length;i+=concurrency){
    results.push(...await Promise.all(rows.slice(i,i+concurrency).map(extractOne)));
  }
  const extracted=results.filter(result=>result.ok).length;
  return NextResponse.json({ ok:true, processed:results.length, extracted, failed:results.length-extracted, results });
}
