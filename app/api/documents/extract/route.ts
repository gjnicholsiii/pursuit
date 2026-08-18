import { get, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface FetchedDocumentRow {
  id: string;
  opportunity_id: string;
  filename: string;
  storage_key: string;
}

export async function GET() {
  const sql = getSql();
  const rows = await sql.query(
    `select d.id, d.opportunity_id, d.filename, d.storage_key
     from opportunity_documents d
     join opportunities o on o.id = d.opportunity_id
     join sources s on s.id = o.source_id
     where s.adapter_key = 'sam_gov'
       and d.extraction_status = 'fetched'
       and d.storage_key is not null
       and lower(d.filename) like '%.pdf'
     order by d.fetched_at asc nulls last, d.id
     limit 1`,
  ) as FetchedDocumentRow[];

  const document = rows[0];
  if (!document) {
    return NextResponse.json({ ok: true, message: "No fetched SAM PDFs are waiting for text extraction" });
  }

  try {
    const blob = await get(document.storage_key, { access: "private" });
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json(
        { ok: false, documentId: document.id, error: "Stored PDF could not be read from private Blob storage" },
        { status: 502 },
      );
    }

    const bytes = await new Response(blob.stream).arrayBuffer();
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const extracted = await extractText(pdf, { mergePages: true });
    const text = extracted.text;

    if (!text.trim()) {
      await sql.query(
        `update opportunity_documents
         set extraction_status = 'text_empty'
         where id = $1::uuid`,
        [document.id],
      );
      return NextResponse.json(
        { ok: false, documentId: document.id, error: "PDF contained no extractable text" },
        { status: 422 },
      );
    }

    const textPath = `extracted/${document.opportunity_id}/${document.id}.txt`;
    const textBlob = await put(textPath, text, {
      access: "private",
      contentType: "text/plain; charset=utf-8",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

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
       values (
         $1::uuid,
         $2::uuid,
         'document_text_extract',
         jsonb_build_object(
           'text_storage_key', $3::text,
           'page_count', $4::int,
           'character_count', $5::int
         ),
         null,
         jsonb_build_object('document_id', $2::text),
         1.0
       )`,
      [document.opportunity_id, document.id, textBlob.pathname, extracted.totalPages, text.length],
    );

    await sql.query(
      `update opportunity_documents
       set extraction_status = 'text_extracted'
       where id = $1::uuid`,
      [document.id],
    );

    return NextResponse.json({
      ok: true,
      documentId: document.id,
      opportunityId: document.opportunity_id,
      filename: document.filename,
      pages: extracted.totalPages,
      characters: text.length,
      textStorageKey: textBlob.pathname,
      extractionStatus: "text_extracted",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        documentId: document.id,
        error: error instanceof Error ? error.message : "PDF text extraction failed",
      },
      { status: 502 },
    );
  }
}
