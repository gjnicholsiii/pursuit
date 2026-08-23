import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const sql = getSql();

  await sql.query(`
    insert into opportunity_documents (opportunity_id, document_type, filename, source_url, referenced_by, extraction_status)
    select o.id, 'sam_resource',
           coalesce(nullif(regexp_replace(split_part(split_part(link,'?',1),'/',array_length(string_to_array(split_part(link,'?',1),'/'),1)), '[^a-zA-Z0-9._() -]+', '-', 'g'),''),'sam-document'),
           link, 'SAM.gov stored resourceLinks recovery', 'cataloged'
    from opportunities o
    join sources s on s.id=o.source_id
    cross join lateral jsonb_array_elements_text(coalesce(o.raw_payload->'resourceLinks','[]'::jsonb)) as x(link)
    where s.adapter_key='sam_gov'
      and o.status='open'
      and (o.due_at is null or o.due_at>=now())
      and link ~ '^https?://'
      and not exists (select 1 from opportunity_documents d where d.opportunity_id=o.id and d.source_url=link)
    on conflict do nothing
  `);

  await sql.query(`
    with magic as (
      select o.id as opportunity_id, o.raw_payload
      from opportunities o join sources s on s.id=o.source_id
      where s.adapter_key='magic_public_ms' and o.status='open' and (o.due_at is null or o.due_at>=now())
    ), urls as (
      select opportunity_id, raw_payload->>'pdfUrl' as url, 'Mississippi MAGIC solicitation PDF'::text as filename
      from magic where coalesce(raw_payload->>'pdfUrl','') ~ '^https?://'
      union all
      select m.opportunity_id, a->>'url', coalesce(nullif(a->>'description',''),'Mississippi MAGIC attachment')
      from magic m cross join lateral jsonb_array_elements(coalesce(m.raw_payload->'attachments','[]'::jsonb)) a
      where coalesce(a->>'url','') ~ '^https?://'
    )
    insert into opportunity_documents(opportunity_id,document_type,filename,source_url,referenced_by,extraction_status)
    select opportunity_id,'sled_resource',left(filename,500),url,'Mississippi MAGIC stored attachment recovery','cataloged'
    from urls
    where not exists(select 1 from opportunity_documents d where d.opportunity_id=urls.opportunity_id and d.source_url=urls.url)
    on conflict do nothing
  `);

  await sql.query(`
    insert into document_jobs (document_id,stage,host_class,priority,state,attempts,max_attempts,run_after,meta)
    select d.id,'acquire',case when d.referenced_by like 'SAM.gov%' then 'sam' else 'sled' end,1,'pending',0,5,now(),jsonb_build_object('reason','stored_link_recovery')
    from opportunity_documents d
    where d.referenced_by in ('SAM.gov stored resourceLinks recovery','Mississippi MAGIC stored attachment recovery')
      and d.storage_key is null and coalesce(d.is_missing,false)=false
    on conflict(document_id,stage) do update set
      state=case when document_jobs.state in ('dead','skipped') then 'pending' else document_jobs.state end,
      priority=least(document_jobs.priority,1),
      run_after=case when document_jobs.state in ('dead','skipped') then now() else document_jobs.run_after end,
      leased_until=case when document_jobs.state in ('dead','skipped') then null else document_jobs.leased_until end,
      lease_owner=case when document_jobs.state in ('dead','skipped') then null else document_jobs.lease_owner end,
      attempts=case when document_jobs.state='dead' then 0 else document_jobs.attempts end,
      meta=coalesce(document_jobs.meta,'{}'::jsonb)||excluded.meta,
      updated_at=now()
  `);

  const counts = await sql.query(`
    select
      count(*) filter (where referenced_by='SAM.gov stored resourceLinks recovery')::int as sam_docs,
      count(*) filter (where referenced_by='Mississippi MAGIC stored attachment recovery')::int as magic_docs
    from opportunity_documents
  `);

  return NextResponse.json({ ok: true, recovered: counts[0] || {} });
}
