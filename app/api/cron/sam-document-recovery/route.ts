import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Row = { id: string; external_id: string; issue_date: string; title: string };
type AnchorRow = { issue_date: string; next_offset: number | string | null };
type SamRecord = { noticeId?: string; resourceLinks?: string[] | null };
type SamResponse = { totalRecords?: number; opportunitiesData?: SamRecord[] };

const SECURITY_RE = /(access control|video surveillance|security system|security camera|cctv|fire alarm|nurse call|low voltage|structured cabling|intrusion|audiovisual|av systems)/i;
const RUN_BUDGET_MS = 240_000;
const PAGE_SIZE = 1000;
const MAX_API_CALLS = 9;
const PROCUREMENT_TYPES = ["o", "p", "k", "r", "s", "i", "u"];

function apiDate(value: string) {
  const d = new Date(value);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function filename(url: string) {
  try {
    const u = new URL(url);
    const explicit = u.searchParams.get("filename") || u.searchParams.get("fn");
    if (explicit) return explicit;
    const parts = u.pathname.split("/").filter(Boolean);
    return `SAM resource ${parts.at(-2) || parts.at(-1) || "file"}`;
  } catch {
    return "SAM resource";
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.SAM_GOV_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: "SAM_GOV_API_KEY is not configured" }, { status: 503 });

  const started = Date.now();
  const deadline = started + RUN_BUDGET_MS;
  const sql = getSql();

  const anchorRows = await sql.query(`
    select o.issue_date::text as issue_date,
           min(coalesce(
             (o.raw_payload->>'pursuitSamPackageCheckedAt')::timestamptz,
             (o.raw_payload->>'pursuitSamPackagePartialAt')::timestamptz,
             'epoch'::timestamptz
           )) as last_scan,
           max(coalesce((o.raw_payload->>'pursuitSamPackageNextOffset')::int,0))::int as next_offset,
           min(case when (o.title||' '||coalesce(o.description,''))~*'(access control|video surveillance|security system|security camera|cctv|fire alarm|nurse call|low voltage|structured cabling|intrusion|audiovisual|av systems)' then 0 else 1 end) as priority
    from opportunities o
    join sources s on s.id=o.source_id
    where s.adapter_key='sam_gov'
      and o.status='open'
      and (o.due_at is null or o.due_at>=now())
      and o.issue_date is not null
      and not exists(select 1 from opportunity_documents d where d.opportunity_id=o.id and coalesce(d.is_missing,false)=false)
      and coalesce(o.raw_payload->>'pursuitPackageStatus','') not in ('scanned_no_public_attachment','access_required')
    group by o.issue_date
    order by priority, last_scan, o.issue_date desc
    limit $1
  `, [MAX_API_CALLS]) as AnchorRow[];

  if (!anchorRows.length) {
    return NextResponse.json({ ok: true, apiCalls: 0, selectedDates: 0, foundOpps: 0, inserted: 0, message: "No SAM package candidates" });
  }

  let inserted = 0;
  let foundOpps = 0;
  let apiCalls = 0;
  let failed = 0;
  let rateLimited = false;
  let completedDays = 0;
  let advancedPages = 0;
  let selected = 0;
  const processed: Array<{ date: string; offset: number; total: number; complete: boolean }> = [];

  for (const anchorRow of anchorRows) {
    if (Date.now() >= deadline || apiCalls >= MAX_API_CALLS || rateLimited) break;

    const anchor = anchorRow.issue_date;
    const requestedOffset = Math.max(0, Number(anchorRow.next_offset || 0));
    const rows = await sql.query(`
      select o.id::text,o.external_id,o.issue_date::text,o.title
      from opportunities o
      join sources s on s.id=o.source_id
      where s.adapter_key='sam_gov'
        and o.status='open'
        and (o.due_at is null or o.due_at>=now())
        and o.issue_date=$1::date
        and not exists(select 1 from opportunity_documents d where d.opportunity_id=o.id and coalesce(d.is_missing,false)=false)
      order by case when (o.title||' '||coalesce(o.description,''))~*'(access control|video surveillance|security system|security camera|cctv|fire alarm|nurse call|low voltage|structured cabling|intrusion|audiovisual|av systems)' then 0 else 1 end,
               o.due_at asc nulls last
    `, [anchor]) as Row[];

    if (!rows.length) continue;
    selected += rows.length;

    const byNotice = new Map(rows.map(row => [row.external_id, row]));
    const url = new URL("https://api.sam.gov/opportunities/v2/search");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(requestedOffset));
    url.searchParams.set("postedFrom", apiDate(anchor));
    url.searchParams.set("postedTo", apiDate(anchor));
    for (const ptype of PROCUREMENT_TYPES) url.searchParams.append("ptype", ptype);

    try {
      apiCalls++;
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });

      if (response.status === 429) {
        rateLimited = true;
        await sql.query(`
          update opportunities o set raw_payload=coalesce(o.raw_payload,'{}'::jsonb)||jsonb_build_object(
            'pursuitPackageStatus','source_http_429',
            'pursuitPackageNote','SAM.gov rate-limited bulk package reconciliation. Pursuit will resume from the saved page offset.'
          )
          from sources s where s.id=o.source_id and s.adapter_key='sam_gov' and o.issue_date=$1::date
            and o.status='open' and (o.due_at is null or o.due_at>=now())
            and not exists(select 1 from opportunity_documents d where d.opportunity_id=o.id and coalesce(d.is_missing,false)=false)
        `, [anchor]);
        break;
      }

      if (!response.ok) {
        failed++;
        continue;
      }

      const body = await response.json() as SamResponse;
      const records = body.opportunitiesData || [];
      const totalRecords = Number(body.totalRecords || records.length);
      const nextOffset = requestedOffset + records.length;
      const completeDay = records.length === 0 || nextOffset >= totalRecords || records.length < PAGE_SIZE;

      for (const record of records) {
        const noticeId = record.noticeId;
        if (!noticeId) continue;
        const row = byNotice.get(noticeId);
        if (!row) continue;

        const links = [...new Set(record.resourceLinks || [])].filter(link => /^https?:\/\//i.test(link));
        if (!links.length) continue;
        foundOpps++;

        for (const link of links) {
          const result = await sql.query(`
            insert into opportunity_documents(opportunity_id,document_type,filename,source_url,referenced_by,extraction_status)
            select $1::uuid,'sam_resource',$2,$3,'SAM.gov bulk package recovery','cataloged'
            where not exists(select 1 from opportunity_documents where opportunity_id=$1::uuid and source_url=$3)
            returning id
          `, [row.id, filename(link), link]) as Array<{ id: string }>;
          inserted += result.length;
        }

        await sql.query(`
          update opportunities set raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object(
            'pursuitSamPackageCheckedAt',now(),'pursuitPackageCheckedAt',now(),
            'pursuitPackageStatus','public_attachments_found',
            'pursuitPackageNote',$2::text
          ) where id=$1::uuid
        `, [row.id, SECURITY_RE.test(row.title) ? "Prioritized security/low-voltage SAM paginated package scan" : "SAM paginated package scan"]);
      }

      if (completeDay) {
        await sql.query(`
          update opportunities o set raw_payload=(coalesce(o.raw_payload,'{}'::jsonb)-'pursuitSamPackageNextOffset'-'pursuitSamPackagePartialAt')||jsonb_build_object(
            'pursuitSamPackageCheckedAt',now(),'pursuitPackageCheckedAt',now(),
            'pursuitPackageStatus','scanned_no_public_attachment',
            'pursuitPackageNote','The complete SAM.gov public API result set for this posted date was scanned and no public resourceLinks were found for this notice.'
          )
          from sources s where s.id=o.source_id and s.adapter_key='sam_gov' and o.issue_date=$1::date
            and o.status='open' and (o.due_at is null or o.due_at>=now())
            and not exists(select 1 from opportunity_documents d where d.opportunity_id=o.id and coalesce(d.is_missing,false)=false)
        `, [anchor]);
        completedDays++;
      } else {
        await sql.query(`
          update opportunities o set raw_payload=coalesce(o.raw_payload,'{}'::jsonb)||jsonb_build_object(
            'pursuitSamPackagePartialAt',now(),'pursuitSamPackageNextOffset',$2::int,
            'pursuitPackageNote',$3::text
          )
          from sources s where s.id=o.source_id and s.adapter_key='sam_gov' and o.issue_date=$1::date
            and o.status='open' and (o.due_at is null or o.due_at>=now())
            and not exists(select 1 from opportunity_documents d where d.opportunity_id=o.id and coalesce(d.is_missing,false)=false)
        `, [anchor, nextOffset, `SAM.gov package reconciliation advanced through API offset ${nextOffset} of ${totalRecords}.`]);
        advancedPages++;
      }

      processed.push({ date: anchor.slice(0, 10), offset: requestedOffset, total: totalRecords, complete: completeDay });
    } catch {
      failed++;
    }
  }

  await sql.query(`
    insert into document_jobs(document_id,stage,host_class,priority,state,attempts,max_attempts,run_after,meta)
    select d.id,'acquire','sam_public',
      case when (o.title||' '||coalesce(o.description,''))~*'(access control|video surveillance|security system|security camera|cctv|fire alarm|nurse call|low voltage|structured cabling|intrusion|audiovisual|av systems)' then 0 else 2 end,
      'pending',0,5,now(),jsonb_build_object('reason','sam_bulk_package_recovery')
    from opportunity_documents d
    join opportunities o on o.id=d.opportunity_id
    where d.referenced_by='SAM.gov bulk package recovery'
      and d.storage_key is null
      and coalesce(d.is_missing,false)=false
      and o.status='open'
    on conflict(document_id,stage) do update set
      host_class='sam_public',priority=least(document_jobs.priority,excluded.priority),
      state=case when document_jobs.state in('dead','skipped') then 'pending' else document_jobs.state end,
      attempts=case when document_jobs.state='dead' then 0 else document_jobs.attempts end,
      run_after=case when document_jobs.state in('dead','skipped') then now() else document_jobs.run_after end,
      updated_at=now()
  `);

  console.log("sam-document-recovery", { apiCalls, processed, selected, foundOpps, inserted, completedDays, advancedPages, failed, rateLimited, elapsedMs: Date.now() - started });

  return NextResponse.json({
    ok: !rateLimited && failed === 0,
    apiCalls,
    processed,
    selected,
    foundOpps,
    inserted,
    completedDays,
    advancedPages,
    failed,
    rateLimited,
    elapsedMs: Date.now() - started,
  }, { status: rateLimited || failed ? 207 : 200 });
}
