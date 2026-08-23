import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

type EvaRow = { id: string; source_url: string };

function cookieHeader(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : [])
    .map(value => value.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._() -]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 500) || "public-attachment";
}

async function recoverEvaAttachments() {
  const sql = getSql();
  const rows = await sql.query(`
    select o.id::text,o.source_url
    from opportunities o join sources s on s.id=o.source_id
    where s.adapter_key='eva_vbo_va'
      and o.status='open' and (o.due_at is null or o.due_at>=now())
      and not exists(select 1 from opportunity_documents d where d.opportunity_id=o.id and coalesce(d.is_missing,false)=false)
    order by coalesce((o.raw_payload->>'pursuitPackageCheckedAt')::timestamptz,'epoch'::timestamptz),o.due_at asc nulls last
    limit 40
  `) as EvaRow[];
  if (!rows.length) return { checked: 0, inserted: 0, accessRequired: 0 };

  let cookie = "";
  try {
    const landing = await fetch("https://mvendor.cgieva.com/Vendor/public/AllOpportunities.jsp", {
      cache: "no-store", redirect: "follow", headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(12000),
    });
    if (landing.ok) cookie = cookieHeader(landing);
  } catch {}

  let inserted = 0;
  let accessRequired = 0;
  for (const row of rows) {
    let packageStatus = "scanned_no_public_attachment";
    try {
      const response = await fetch(row.source_url, {
        cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(12000),
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", ...(cookie ? { cookie } : {}) },
      });
      if ([401,403].includes(response.status)) {
        packageStatus = "access_required";
        accessRequired++;
      } else if (response.ok) {
        const html = await response.text();
        const $ = cheerio.load(html);
        const links = new Map<string,string>();
        $("a[href]").each((_, node) => {
          const href = $(node).attr("href") || "";
          const text = $(node).text().replace(/\s+/g, " ").trim();
          if (!/download\.jsp|attachment_id=|\/download(?:[/?]|$)/i.test(href)) return;
          try {
            const url = new URL(href, response.url || row.source_url).toString();
            links.set(url, safeFilename(text || new URL(url).searchParams.get("attachment_name") || "eVA attachment"));
          } catch {}
        });
        for (const match of html.matchAll(/(?:https?:\/\/[^"'<>\s]+|\/Vendor\/public\/download\.jsp\?[^"'<>\s]+)/gi)) {
          if (!/download\.jsp|attachment_id=/i.test(match[0])) continue;
          try {
            const url = new URL(match[0].replace(/&amp;/g,"&"), response.url || row.source_url).toString();
            const parsed = new URL(url);
            links.set(url, safeFilename(parsed.searchParams.get("attachment_name") || "eVA attachment"));
          } catch {}
        }
        for (const [url, filename] of links) {
          const result = await sql.query(`
            insert into opportunity_documents(opportunity_id,document_type,filename,source_url,referenced_by,extraction_status)
            select $1::uuid,'sled_resource',$2,$3,'Virginia eVA public attachment recovery','cataloged'
            where not exists(select 1 from opportunity_documents where opportunity_id=$1::uuid and source_url=$3)
            returning id
          `,[row.id,filename,url]) as Array<{id:string}>;
          inserted += result.length;
        }
        if (links.size) packageStatus = "public_attachments_found";
        else if (/you don.?t have permissions|login to view|sign in to view|authentication required/i.test(html)) {
          packageStatus = "access_required";
          accessRequired++;
        }
      } else packageStatus = `source_http_${response.status}`;
    } catch { packageStatus = "source_unreachable"; }
    await sql.query(`update opportunities set raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object('pursuitPackageCheckedAt',now(),'pursuitPackageStatus',$2::text) where id=$1::uuid`,[row.id,packageStatus]);
  }
  return { checked: rows.length, inserted, accessRequired };
}

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

  const eva = await recoverEvaAttachments();

  // NC eVP exposes the solicitation itself publicly but its Attachments section returns a permissions error to anonymous users.
  // Record that distinction so the UI never reports a public-package discovery failure as if no package exists.
  await sql.query(`
    update opportunities o set raw_payload=coalesce(o.raw_payload,'{}'::jsonb)||jsonb_build_object(
      'pursuitPackageCheckedAt',now(),'pursuitPackageStatus','access_required','pursuitPackageNote','NC eVP attachment records require portal permission')
    from sources s
    where o.source_id=s.id and s.adapter_key='powerpages_nc'
      and o.status='open' and (o.due_at is null or o.due_at>=now())
      and not exists(select 1 from opportunity_documents d where d.opportunity_id=o.id and coalesce(d.is_missing,false)=false)
  `);

  await sql.query(`
    insert into document_jobs (document_id,stage,host_class,priority,state,attempts,max_attempts,run_after,meta)
    select d.id,'acquire',case when s.adapter_key='sam_gov' then 'sam' else 'sled' end,1,'pending',0,5,now(),jsonb_build_object('reason','stored_link_recovery')
    from opportunity_documents d
    join opportunities o on o.id=d.opportunity_id
    join sources s on s.id=o.source_id
    where d.referenced_by in ('SAM.gov stored resourceLinks recovery','Mississippi MAGIC stored attachment recovery','Virginia eVA public attachment recovery')
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
      count(*) filter (where referenced_by='Mississippi MAGIC stored attachment recovery')::int as magic_docs,
      count(*) filter (where referenced_by='Virginia eVA public attachment recovery')::int as eva_docs
    from opportunity_documents
  `);

  return NextResponse.json({ ok: true, recovered: counts[0] || {}, eva });
}
