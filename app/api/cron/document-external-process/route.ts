import { get, put } from "@vercel/blob";
import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_SIZE = 40;
const CONCURRENCY = 6;
const MAX_TEXT = 12_000_000;

type Row = {
  id: string;
  opportunity_id: string;
  filename: string;
  storage_key: string;
  host_class: string;
  priority: number;
};

type Kind = "pdf" | "zip" | "legacy_office" | "rtf" | "html" | "text" | "empty" | "unavailable";

function stripRtf(raw: string) {
  return raw
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\\'[0-9a-fA-F]{2}/g, m => String.fromCharCode(parseInt(m.slice(2), 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlText(raw: string) {
  const $ = cheerio.load(raw);
  $("script,style,noscript,svg").remove();
  return $("body").text().replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

async function readStored(storageKey: string): Promise<{ kind: Kind; bytes?: Uint8Array; text?: string }> {
  const blob = await get(storageKey, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return { kind: "unavailable" };
  const buffer = new Uint8Array(await new Response(blob.stream).arrayBuffer());
  if (!buffer.length) return { kind: "empty", bytes: buffer };
  const sample = buffer.slice(0, Math.min(buffer.length, 4096));
  const latin = new TextDecoder("latin1").decode(sample);
  if (latin.indexOf("%PDF") >= 0 && latin.indexOf("%PDF") < 1024) return { kind: "pdf", bytes: buffer };
  if (sample[0] === 0x50 && sample[1] === 0x4b) return { kind: "zip", bytes: buffer };
  if (sample.length >= 8 && sample[0] === 0xd0 && sample[1] === 0xcf && sample[2] === 0x11 && sample[3] === 0xe0 && sample[4] === 0xa1 && sample[5] === 0xb1 && sample[6] === 0x1a && sample[7] === 0xe1) return { kind: "legacy_office", bytes: buffer };
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(buffer.slice(0, Math.min(buffer.length, MAX_TEXT * 2)));
  const trimmed = decoded.replace(/^\uFEFF/, "").trimStart();
  if (/^\{\\rtf/i.test(trimmed)) return { kind: "rtf", bytes: buffer, text: stripRtf(decoded) };
  if (/^\s*(?:<!doctype html|<html|<head|<body)/i.test(trimmed)) return { kind: "html", bytes: buffer, text: htmlText(decoded) };
  const control = (decoded.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  if (decoded.length && control / decoded.length < 0.02) return { kind: "text", bytes: buffer, text: decoded.replace(/\u0000/g, "").trim() };
  return { kind: "legacy_office", bytes: buffer };
}

async function persistText(row: Row, text: string, kind: Kind) {
  const sql = getSql();
  const body = text.slice(0, MAX_TEXT).trim();
  if (!body) {
    await sql.query(`update opportunity_documents set extraction_status='text_empty' where id=$1::uuid and extraction_status='external_processing_required'`, [row.id]);
    return { kind, outcome: "text_empty" };
  }
  const textPath = `extracted/${row.opportunity_id}/${row.id}.txt`;
  const stored = await put(textPath, body, { access: "private", contentType: "text/plain; charset=utf-8", addRandomSuffix: false, allowOverwrite: true });
  await sql.query(
    `insert into extracted_facts(opportunity_id,document_id,fact_type,normalized_value,source_text,evidence_locator,extraction_confidence)
     select $1::uuid,$2::uuid,'document_text_extract',jsonb_build_object('text_storage_key',$3::text,'page_count',null,'character_count',$4::int,'truncated',$5::boolean,'source_format',$6::text),null,jsonb_build_object('document_id',$2::text),0.98
     where not exists(select 1 from extracted_facts where document_id=$2::uuid and fact_type='document_text_extract')`,
    [row.opportunity_id, row.id, stored.pathname, body.length, text.length > MAX_TEXT, kind]
  );
  await sql.query(`update opportunity_documents set extraction_status='text_extracted' where id=$1::uuid and extraction_status='external_processing_required'`, [row.id]);
  await sql.query(
    `insert into document_jobs(document_id,stage,host_class,priority,meta) values($1::uuid,'analyze',$2,$3,jsonb_build_object('source_format',$4::text,'external_processor',true))
     on conflict(document_id,stage) do update set priority=least(document_jobs.priority,excluded.priority),state=case when document_jobs.state in('done','leased') then document_jobs.state else 'pending' end,run_after=case when document_jobs.state in('done','leased') then document_jobs.run_after else now() end,meta=coalesce(document_jobs.meta,'{}'::jsonb)||excluded.meta,updated_at=now()`,
    [row.id, row.host_class || "other", Math.max(0, Number(row.priority || 100) - 10), kind]
  );
  return { kind, outcome: "text_extracted", characters: body.length };
}

async function processOne(row: Row) {
  const sql = getSql();
  try {
    const payload = await readStored(row.storage_key);
    if (payload.kind === "pdf") {
      await sql.query(`update opportunity_documents set extraction_status='fetched',filename=case when lower(coalesce(filename,'')) like '%.pdf' then filename else coalesce(nullif(filename,''),'document')||'.pdf' end where id=$1::uuid and extraction_status='external_processing_required'`, [row.id]);
      await sql.query(`insert into document_jobs(document_id,stage,host_class,priority,meta) values($1::uuid,'extract',$2,$3,jsonb_build_object('external_processor_pdf_recovery',true)) on conflict(document_id,stage) do update set state=case when document_jobs.state in('done','leased') then document_jobs.state else 'pending' end,run_after=case when document_jobs.state in('done','leased') then document_jobs.run_after else now() end,updated_at=now()`, [row.id, row.host_class || "other", row.priority || 100]);
      return { kind: payload.kind, outcome: "pdf_recovered" };
    }
    if (payload.kind === "rtf" || payload.kind === "html" || payload.kind === "text") return persistText(row, payload.text || "", payload.kind);
    const status = payload.kind === "zip" || payload.kind === "legacy_office" ? "external_archive_required" : "unavailable";
    await sql.query(`update opportunity_documents set extraction_status=$2 where id=$1::uuid and extraction_status='external_processing_required'`, [row.id, status]);
    return { kind: payload.kind, outcome: status };
  } catch (error) {
    return { kind: "error", outcome: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET(request: NextRequest) {
  const auth = requireInternalAuth(request); if (auth) return auth;
  const sql = getSql();
  const rows = await sql.query(
    `select d.id::text,d.opportunity_id::text,d.filename,d.storage_key,coalesce(a.host_class,'other') host_class,greatest(0,coalesce(a.priority,100)-10) priority
       from opportunity_documents d
       join opportunities o on o.id=d.opportunity_id
       left join lateral(select j.host_class,j.priority from document_jobs j where j.document_id=d.id and j.stage='acquire' order by j.id desc limit 1) a on true
      where d.extraction_status='external_processing_required' and d.storage_key is not null
        and lower(coalesce(o.status,'')) in('open','active','posted') and (o.due_at is null or o.due_at>=now())
      order by d.fetched_at nulls first,d.id limit ${BATCH_SIZE}`
  ) as Row[];
  const results: Array<Record<string, unknown>> = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) results.push(...await Promise.all(rows.slice(i, i + CONCURRENCY).map(processOne)));
  const summary = results.reduce<Record<string, number>>((acc, item) => { const key = String(item.outcome || "unknown"); acc[key] = (acc[key] || 0) + 1; return acc; }, {});
  const errors = Number(summary.error || 0);
  console.info("DOCUMENT_EXTERNAL_PROCESS", { scanned: rows.length, summary, errors });
  return NextResponse.json({ ok: errors === 0, scanned: rows.length, summary, errors });
}
