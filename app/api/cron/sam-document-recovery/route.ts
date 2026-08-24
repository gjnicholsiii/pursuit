import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Row = { id: string; external_id: string; issue_date: string; title: string };
type SamRecord = { noticeId?: string; resourceLinks?: string[] | null };
type SamResponse = { totalRecords?: number; opportunitiesData?: SamRecord[] };
const SECURITY_RE = /(access control|video surveillance|security system|security camera|cctv|fire alarm|nurse call|low voltage|structured cabling|intrusion|audiovisual|av systems)/i;
const RUN_BUDGET_MS = 240_000;
const PAGE_SIZE = 1000;
// Preserve headroom under SAM.gov's lowest published personal-key daily allowance.
// The scheduled job now runs once per day, so these calls are spent on distinct posted dates.
const MAX_API_CALLS = 6;

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
           min(case when (o.title||' '||coalesce(o.description,''))~*'(access control|video surveillance|security system|security camera|cctv|fire alarm|nurse call|low voltage|structured cabling|intrusion|audiovisual|av systems)' then 0 else 1 end) as priority
    from opportunities o
    join sources s on s.id=o.source_id
    where s.adapter_key='sam_gov'
      and o.status='open'
      and (o.due_at is null or o.due_at>=now())
      and not exists(select 1 from opportunity_documents d where d.opportunity_id=o.id and coalesce(d.is_missing,false)=false)
    group by o.issue_date
    order by priority, last_scan, o.issue_date desc
    limit $1
  `, [MAX_API_CALLS]) as Array<{ issue_date: string }>;

  if (!anchorRows.length) return NextResponse.json({ ok: true, apiCalls: 0, selectedDates: 0, foundOpps: 0, inserted: 0, message: "No SAM package candidates" });

  let inserted = 0;
  let foundOpps = 0;
  let apiCalls = 0;
  let failed = 0;
  let rateLimited = false;
  let completeDates = 0;
  let partialDates = 0;
  let selected = 0;
  const processedDates: string[] = [];

  for (const anchorRow of anchorRows) {
    if (Date.now() >= deadline || apiCalls >= MAX_API_CALLS || rateLimited) break;
    const anchor = anchorRow.issue_date;
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
    const found = new Set<string>();
    const url = new URL("https://api.sam.gov/opportunities/v2/search");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", "0");
    url.searchParams.set("postedFrom", apiDate(anchor));
    url.searchParams.set("postedTo", apiDate(anchor));

    let completeDay = false;
    let totalRecords = 0;
    try {
      apiCalls++;
      const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(30000) });
      if (response.status === 429) {
        rateLimited = true;
        break;
      }
      if (!response.ok) {
        failed++;
        continue;
      }

      const body = await response.json() as SamResponse;
      const records = body.opportunitiesData || [];
      totalRecords = Number(body.totalRecords || records.length);
      completeDay = records.length >= totalRecords || records.length < PAGE_SIZE;

      for (const record of records) {
        const noticeId = record.noticeId;
        if (!noticeId) continue;
        const row = byNotice.get(noticeId);
        if (!row) continue;
        found.add(noticeId);
        const links = [...new Set(record.resourceLinks || [])].filter(link => /^https?:\/\//i.test(link));
        if (links.length) foundOpps++;
        for (const link of links) {
          const result = await sql.query(`
            insert into opportunity_documents(opportunity_id,document_type,filename,source_url,referenced_by,extraction_status)
            select $1::uuid,'sam_resource',$2,$3,'SAM.gov bulk package recovery','cataloged'
            where not exists(select 1 from opportunity_documents where opportunity_id=$1::uuid and source_url=$3)
            returning id
          `, [row.id, filename(link), link]) as Array<{ id: string }>;
          inserted += result.length;
        }
      }

      for (const row of rows) {
        const hasDocs = found.has(row.external_id)
          ? (await sql.query(`select exists(select 1 from opportunity_documents where opportunity_id=$1::uuid and coalesce(is_missing,false)=false) as has_docs`, [row.id]) as Array<{ has_docs: boolean }>)[0]?.has_docs
          : false;
        if (hasDocs) {
          await sql.query(`
            update opportunities set raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object(
              'pursuitSamPackageCheckedAt',now(),'pursuitPackageCheckedAt',now(),
              'pursuitPackageStatus','public_attachments_found',
              'pursuitPackageNote',$2::text
            ) where id=$1::uuid
          `, [row.id, SECURITY_RE.test(row.title) ? "Prioritized security/low-voltage SAM posted-date package scan" : "SAM posted-date package scan"]);
        } else if (completeDay) {
          await sql.query(`
            update opportunities set raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object(
              'pursuitSamPackageCheckedAt',now(),'pursuitPackageCheckedAt',now(),
              'pursuitPackageStatus','scanned_no_public_attachment',
              'pursuitPackageNote',$2::text
            ) where id=$1::uuid
          `, [row.id, SECURITY_RE.test(row.title) ? "Prioritized security/low-voltage SAM posted-date package scan" : "SAM posted-date package scan"]);
        } else {
          await sql.query(`
            update opportunities set raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object('pursuitSamPackagePartialAt',now())
            where id=$1::uuid
          `, [row.id]);
        }
      }

      if (completeDay) completeDates++;
      else partialDates++;
      processedDates.push(anchor.slice(0, 10));
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

  console.log("sam-document-recovery", { apiCalls, selectedDates: processedDates.length, completeDates, partialDates, selected, foundOpps, inserted, failed, rateLimited, elapsedMs: Date.now() - started });
  return NextResponse.json({
    ok: !rateLimited && failed === 0,
    apiCalls,
    selectedDates: processedDates.length,
    dates: processedDates,
    completeDates,
    partialDates,
    selected,
    foundOpps,
    inserted,
    failed,
    rateLimited,
    elapsedMs: Date.now() - started,
  }, { status: rateLimited || failed ? 207 : 200 });
}
