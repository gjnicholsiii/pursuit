import { get } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_SIZE = 80;
const CONCURRENCY = 8;

type FetchedRow = {
  id: string;
  filename: string;
  storage_key: string;
  host_class: string;
  priority: number;
};

type PayloadKind = "pdf" | "zip" | "legacy_office" | "rtf" | "html" | "text_or_other" | "unavailable" | "empty";

async function readMagic(storageKey: string): Promise<PayloadKind> {
  const blob = await get(storageKey, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return "unavailable";
  const reader = blob.stream.getReader();
  try {
    const { value } = await reader.read();
    if (!value || value.length === 0) return "empty";
    const sample = value.slice(0, Math.min(value.length, 4096));
    const ascii = new TextDecoder("latin1").decode(sample);
    if (ascii.indexOf("%PDF") >= 0 && ascii.indexOf("%PDF") < 1024) return "pdf";
    if (sample[0] === 0x50 && sample[1] === 0x4b) return "zip";
    if (sample.length >= 8 && sample[0] === 0xd0 && sample[1] === 0xcf && sample[2] === 0x11 && sample[3] === 0xe0 && sample[4] === 0xa1 && sample[5] === 0xb1 && sample[6] === 0x1a && sample[7] === 0xe1) return "legacy_office";
    const trimmed = ascii.replace(/^\uFEFF/, "").trimStart().toLowerCase();
    if (trimmed.startsWith("{\\rtf")) return "rtf";
    if (trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html") || trimmed.startsWith("<head") || trimmed.startsWith("<body")) return "html";
    return "text_or_other";
  } finally {
    try { await reader.cancel(); } catch {}
  }
}

async function markExternal(row: FetchedRow, kind: PayloadKind) {
  await getSql().query(
    `update opportunity_documents
        set extraction_status='external_processing_required'
      where id=$1::uuid and extraction_status='fetched'`,
    [row.id]
  );
  return { kind, queued: false, externalized: true };
}

async function reconcileOne(row: FetchedRow) {
  const sql = getSql();
  try {
    const kind = await readMagic(row.storage_key);
    if (kind === "pdf") {
      const filename = /\.pdf$/i.test(row.filename || "") ? row.filename : `${row.filename || "document"}.pdf`;
      await sql.query(
        `update opportunity_documents set filename=$2 where id=$1::uuid and extraction_status='fetched'`,
        [row.id, filename]
      );
      await sql.query(
        `insert into document_jobs(document_id,stage,host_class,priority,meta)
         values($1::uuid,'extract',$2,$3,jsonb_build_object('reconciled_from_fetched',true))
         on conflict(document_id,stage) do update
           set priority=least(document_jobs.priority,excluded.priority),
               state=case when document_jobs.state='leased' and document_jobs.leased_until>now() then 'leased' else 'pending' end,
               run_after=case when document_jobs.state='leased' and document_jobs.leased_until>now() then document_jobs.run_after else now() end,
               leased_until=case when document_jobs.state='leased' and document_jobs.leased_until>now() then document_jobs.leased_until else null end,
               lease_owner=case when document_jobs.state='leased' and document_jobs.leased_until>now() then document_jobs.lease_owner else null end,
               last_error=case when document_jobs.state='leased' and document_jobs.leased_until>now() then document_jobs.last_error else null end,
               meta=coalesce(document_jobs.meta,'{}'::jsonb)||excluded.meta,
               updated_at=now()`,
        [row.id, row.host_class || "other", row.priority ?? 100]
      );
      return { kind, queued: true, externalized: false };
    }

    if (kind !== "unavailable") return markExternal(row, kind);

    return { kind, queued: false, externalized: false };
  } catch (error) {
    return { kind: "error", queued: false, externalized: false, error: error instanceof Error ? error.message : "reconcile_failed" };
  }
}

export async function GET(request: NextRequest) {
  const unauthorized = requireInternalAuth(request);
  if (unauthorized) return unauthorized;

  const sql = getSql();
  const rows = await sql.query(
    `select d.id,d.filename,d.storage_key,
            coalesce(a.host_class,'other') as host_class,
            greatest(0,coalesce(a.priority,100)-10) as priority
       from opportunity_documents d
       join opportunities o on o.id=d.opportunity_id
       left join lateral (
         select j.host_class,j.priority
           from document_jobs j
          where j.document_id=d.id and j.stage='acquire'
          order by j.id desc limit 1
       ) a on true
      where d.extraction_status='fetched'
        and d.storage_key is not null
        and lower(coalesce(o.status,'')) in ('open','active','posted')
        and (o.due_at is null or o.due_at>=now())
        and not exists (
          select 1 from document_jobs j
           where j.document_id=d.id
             and j.stage in ('extract','ocr')
             and (
               j.state='pending'
               or (j.state='leased' and j.leased_until>now())
             )
        )
      order by d.fetched_at nulls first,d.id
      limit ${BATCH_SIZE}`
  ) as FetchedRow[];

  const results: Array<{ kind: string; queued: boolean; externalized: boolean; error?: string }> = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    results.push(...await Promise.all(rows.slice(i, i + CONCURRENCY).map(reconcileOne)));
  }

  const summary = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.kind] = (acc[result.kind] || 0) + 1;
    return acc;
  }, {});
  const queued = results.filter(result => result.queued).length;
  const externalized = results.filter(result => result.externalized).length;
  const errors = results.filter(result => result.kind === "error").length;

  console.info("DOCUMENT_FETCHED_RECONCILE", { scanned: rows.length, queued, externalized, errors, summary });
  return NextResponse.json({ ok: errors === 0, scanned: rows.length, queued, externalized, errors, summary });
}
