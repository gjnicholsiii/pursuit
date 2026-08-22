import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";
import { refreshJaggaerEventDocuments } from "@/lib/sled/jaggaer-document";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

type Row = {
  job_id: string;
  document_id: string;
  filename: string;
  base_url: string;
  adapter_key: string;
  state: "pending" | "dead";
};

export async function GET(request: NextRequest) {
  const unauthorized = requireInternalAuth(request);
  if (unauthorized) return unauthorized;

  const sql = getSql();
  const rows = await sql.query(
    `select j.id::text as job_id,d.id::text as document_id,d.filename,s.base_url,s.adapter_key,j.state
     from document_jobs j
     join opportunity_documents d on d.id=j.document_id
     join opportunities o on o.id=d.opportunity_id
     join sources s on s.id=o.source_id
     where j.stage='acquire'
       and j.state in ('pending','dead')
       and s.adapter_key like 'jaggaer_%'
       and lower(coalesce(d.filename,'')) like '%-event.pdf'
       and d.storage_key is null
       and coalesce(d.is_missing,false)=false
       and o.status='open'
       and (o.due_at is null or o.due_at>=now())
     order by case when j.state='dead' then 0 else 1 end,j.run_after asc,j.updated_at asc
     limit 1200`,
  ) as Row[];

  if (!rows.length) return NextResponse.json({ ok:true, candidates:0, refreshed:0, message:"No live JAGGAER event PDFs need refresh" });

  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const list = groups.get(row.base_url) || [];
    list.push(row);
    groups.set(row.base_url, list);
  }

  let refreshed = 0;
  let unresolved = 0;
  const bySource: Array<{adapterKey:string;candidates:number;refreshed:number;unresolved:number}> = [];

  for (const [baseUrl, group] of groups) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    let urls = new Map<string,string>();
    try {
      urls = await refreshJaggaerEventDocuments(baseUrl, [...new Set(group.map(row => row.filename))], controller.signal, UA);
    } catch {}
    clearTimeout(timeout);

    let sourceRefreshed = 0;
    for (const row of group) {
      const freshUrl = urls.get(row.filename);
      if (!freshUrl) { unresolved++; continue; }
      await sql.query(
        `update opportunity_documents set source_url=$2,extraction_status='cataloged' where id=$1::uuid`,
        [row.document_id, freshUrl],
      );
      if (row.state === "dead") {
        await sql.query(
          `update document_jobs set state='pending',attempts=0,run_after=now(),leased_until=null,lease_owner=null,last_error=null,updated_at=now()
           where id=$1::bigint`,
          [row.job_id],
        );
      } else {
        // Refreshing a signed URL must not move an already-ready job to the back of
        // the acquisition queue. Preserve run_after and attempts for pending work.
        await sql.query(
          `update document_jobs set last_error=null,updated_at=now() where id=$1::bigint`,
          [row.job_id],
        );
      }
      refreshed++;
      sourceRefreshed++;
    }
    bySource.push({ adapterKey: group[0].adapter_key, candidates: group.length, refreshed: sourceRefreshed, unresolved: group.length-sourceRefreshed });
  }

  return NextResponse.json({ ok:true, candidates:rows.length, refreshed, unresolved, bySource });
}
