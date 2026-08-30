import { get, put } from "@vercel/blob";
import * as cheerio from "cheerio";
import { inflateRawSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_SIZE = 40;
const CONCURRENCY = 6;
const MAX_TEXT = 12_000_000;
const MAX_ARCHIVE_TEXT = 4_000_000;

type Row = {
  id: string;
  opportunity_id: string;
  filename: string;
  storage_key: string;
  host_class: string;
  priority: number;
};

type Kind = "pdf" | "zip" | "ooxml" | "legacy_office" | "rtf" | "html" | "text" | "empty" | "unavailable";

type ZipEntry = {
  name: string;
  compression: number;
  compressedSize: number;
  localOffset: number;
};

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

function u16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function findEocd(bytes: Uint8Array) {
  const min = Math.max(0, bytes.length - 65_557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(bytes, i) === 0x06054b50) return i;
  }
  return -1;
}

function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const eocd = findEocd(bytes);
  if (eocd < 0) return [];
  const count = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count && offset + 46 <= bytes.length; i++) {
    if (u32(bytes, offset) !== 0x02014b50) break;
    const compression = u16(bytes, offset + 10);
    const compressedSize = u32(bytes, offset + 20);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);
    const localOffset = u32(bytes, offset + 42);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    entries.push({ name, compression, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array | null {
  const offset = entry.localOffset;
  if (offset + 30 > bytes.length || u32(bytes, offset) !== 0x04034b50) return null;
  const nameLength = u16(bytes, offset + 26);
  const extraLength = u16(bytes, offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (start < 0 || end > bytes.length) return null;
  const chunk = bytes.slice(start, end);
  if (entry.compression === 0) return chunk;
  if (entry.compression === 8) return new Uint8Array(inflateRawSync(chunk));
  return null;
}

function xmlText(raw: string) {
  const normalized = raw
    .replace(/<\/(?:w:p|a:p|p|row|si)>/gi, "\n")
    .replace(/<(?:w:tab|tab)\b[^>]*\/?>/gi, "\t")
    .replace(/<br\b[^>]*\/?>/gi, "\n");
  const $ = cheerio.load(normalized, { xmlMode: true });
  return $.root().text().replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function extractOoxmlText(bytes: Uint8Array): { kind: Kind; text?: string } {
  const entries = listZipEntries(bytes);
  if (!entries.length) return { kind: "zip" };
  const names = new Set(entries.map(e => e.name));
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];

  const append = (entry: ZipEntry) => {
    const data = readZipEntry(bytes, entry);
    if (!data || !data.length) return;
    const text = xmlText(decoder.decode(data));
    if (text) chunks.push(text);
  };

  if (names.has("word/document.xml")) {
    for (const entry of entries) {
      if (entry.name === "word/document.xml" || /^word\/(?:header|footer|footnotes|endnotes)\d*\.xml$/i.test(entry.name)) append(entry);
    }
    return { kind: "ooxml", text: chunks.join("\n").slice(0, MAX_ARCHIVE_TEXT) };
  }

  if ([...names].some(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))) {
    for (const entry of entries.filter(e => /^ppt\/slides\/slide\d+\.xml$/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))) append(entry);
    return { kind: "ooxml", text: chunks.join("\n").slice(0, MAX_ARCHIVE_TEXT) };
  }

  if (names.has("xl/workbook.xml")) {
    const sharedEntry = entries.find(e => e.name === "xl/sharedStrings.xml");
    if (sharedEntry) append(sharedEntry);
    for (const entry of entries.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))) append(entry);
    return { kind: "ooxml", text: chunks.join("\n").slice(0, MAX_ARCHIVE_TEXT) };
  }

  const textEntries = entries.filter(e =>
    /\.(?:txt|csv|xml|html?|rtf)$/i.test(e.name) &&
    !e.name.startsWith("__MACOSX/") &&
    e.compressedSize <= 10_000_000
  );
  let total = 0;
  for (const entry of textEntries.slice(0, 100)) {
    const data = readZipEntry(bytes, entry);
    if (!data) continue;
    const raw = decoder.decode(data);
    const lower = entry.name.toLowerCase();
    const text = lower.endsWith(".rtf") ? stripRtf(raw) : lower.endsWith(".html") || lower.endsWith(".htm") ? htmlText(raw) : lower.endsWith(".xml") ? xmlText(raw) : raw;
    if (text.trim()) {
      const chunk = `${entry.name}\n${text.trim()}`;
      chunks.push(chunk);
      total += chunk.length;
    }
    if (total >= MAX_ARCHIVE_TEXT) break;
  }
  if (chunks.length) return { kind: "zip", text: chunks.join("\n\n").slice(0, MAX_ARCHIVE_TEXT) };
  return { kind: "zip" };
}

async function readStored(storageKey: string): Promise<{ kind: Kind; bytes?: Uint8Array; text?: string }> {
  const blob = await get(storageKey, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return { kind: "unavailable" };
  const buffer = new Uint8Array(await new Response(blob.stream).arrayBuffer());
  if (!buffer.length) return { kind: "empty", bytes: buffer };
  const sample = buffer.slice(0, Math.min(buffer.length, 4096));
  const latin = new TextDecoder("latin1").decode(sample);
  if (latin.indexOf("%PDF") >= 0 && latin.indexOf("%PDF") < 1024) return { kind: "pdf", bytes: buffer };
  if (sample[0] === 0x50 && sample[1] === 0x4b) {
    const archive = extractOoxmlText(buffer);
    return { ...archive, bytes: buffer };
  }
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
    if (payload.kind === "rtf" || payload.kind === "html" || payload.kind === "text" || payload.kind === "ooxml" || (payload.kind === "zip" && payload.text)) {
      return persistText(row, payload.text || "", payload.kind);
    }
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
