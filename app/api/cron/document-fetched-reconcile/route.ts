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

async function readMagic(storageKey: string) {
  const blob = await get(storageKey, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return "unavailable" as const;
  const reader = blob.stream.getReader();
  try {
    const { value } = await reader.read();
    if (!value || value.length === 0) return "empty" as const;
    const head = value.slice(0, 8);
    const ascii = String.fromCharCode(...head);
    if (ascii.startsWith("%PDF")) return "pdf" as const;
    if (head[0] === 0x50 && head[1] === 0x4b) return "zip" as const;
    return "other" as const;
  } finally {
    try { await reader.cancel(); } catch {}
  }
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
               state=case when document_jobs.state in ('done','leased') then document_jobs.state else 'pending' end,
               run_after=case when document_jobs.state in ('done','leased') then document_jobs.run_after else now() end,
               leased_until=case when document_jobs.state in ('done','leased') then document_jobs.leased_until else null end,
               lease_owner=case when document_jobs.state in ('done','leased') then document_jobs.lease_owner else null end,
               last_error=case when document_jobs.state in ('done','leased') then document_jobs.last_error else null end,
               meta=coalesce(document_jobs.meta,'{}'::jsonb)||excluded.meta,
               updated_at=now()`,
        [row.id, row.host_class || "other", row.priority ?? 100]
      );
      return { kind, queued: true };
    }

    if (kind === "zip" && /\.(docx|xlsx|pptx|zip)$/i.test(row.filename || "")) {
      await sql.query(
        `update opportunity_documents
            set extraction_status='external_processing_required'
          where id=$1::uuid and extraction_status='fetched'`,
        [row.id]
      );
      return { kind: "office_archive", queued: false };
    }

    return { kind, queued: false };
  } catch (error) {
    return { kind: "error", queued: false, error: error instanceof Error ? error.message : "reconcile_failed" };
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
           where j.document_id=d.id and j.stage in ('extract','ocr')
        )
      order by d.fetched_at nulls first,d.id
      limit ${BATCH_SIZE}`
  ) as FetchedRow[];

  const results: Array<{ kind: string; queued: boolean; error?: string }> = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    results.push(...await Promise.all(rows.slice(i, i + CONCURRENCY).map(reconcileOne)));
  }

  const summary = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.kind] = (acc[result.kind] || 0) + 1;
    return acc;
  }, {});
  const queued = results.filter(result => result.queued).length;
  const errors = results.filter(result => result.kind === "error").length;

  console.info("DOCUMENT_FETCHED_RECONCILE", { scanned: rows.length, queued, errors, summary });
  return NextResponse.json({ ok: errors === 0, scanned: rows.length, queued, errors, summary });
}
