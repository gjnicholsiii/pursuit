import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SamSearchResponse = { opportunitiesData?: Array<{ noticeId?: string; resourceLinks?: string[] | null }> };
type OpportunityRow = {
  id: string;
  external_id: string;
  issue_date: string | null;
  posted_date: string | null;
  raw_links: unknown;
};

function apiDate(value: string | null) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function filename(url: string) {
  try {
    const parsed = new URL(url);
    const explicit = parsed.searchParams.get("filename") || parsed.searchParams.get("fn");
    if (explicit) return explicit;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const id = parts.at(-2) || parts.at(-1) || "resource";
    return `SAM resource ${id}`;
  } catch {
    return "SAM resource";
  }
}

function validLinks(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.filter((link): link is string => typeof link === "string" && /^https?:\/\//i.test(link)))];
}

export async function GET(request: NextRequest) {
  const auth = requireInternalAuth(request);
  if (auth) return auth;

  const opportunityId = request.nextUrl.searchParams.get("opportunityId");
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  if (!opportunityId) return NextResponse.json({ ok: false, error: "opportunityId is required" }, { status: 400 });

  const sql = getSql();
  const rows = await sql.query(
    `select o.id,o.external_id,o.issue_date,o.raw_payload->>'postedDate' as posted_date,
            o.raw_payload->'resourceLinks' as raw_links
     from opportunities o
     join sources s on s.id=o.source_id
     where o.id=$1 and s.adapter_key='sam_gov' and o.status='open'
       and (o.due_at is null or o.due_at>=now())
     limit 1`,
    [opportunityId],
  ) as OpportunityRow[];

  const opp = rows[0];
  if (!opp) return NextResponse.json({ ok: false, error: "Open SAM opportunity not found" }, { status: 404 });

  let links = validLinks(opp.raw_links);
  let source = "stored_sam_record";

  if (!links.length) {
    const apiKey = process.env.SAM_GOV_API_KEY;
    if (!apiKey) {
      await sql.query(
        `update opportunities set raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object(
           'pursuitPackageCheckedAt',now(),'pursuitPackageStatus','source_unreachable',
           'pursuitPackageNote','SAM.gov package lookup is unavailable because the public API key is not configured.'
         ) where id=$1`,
        [opportunityId],
      );
      return NextResponse.json({ ok: false, error: "SAM_GOV_API_KEY is not configured" }, { status: 503 });
    }

    const posted = new Date(opp.posted_date || opp.issue_date || Date.now());
    const from = new Date(posted);
    from.setUTCDate(from.getUTCDate() - 2);
    const to = new Date(posted);
    to.setUTCDate(to.getUTCDate() + 2);

    const url = new URL("https://api.sam.gov/opportunities/v2/search");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("noticeid", opp.external_id);
    url.searchParams.set("limit", "10");
    url.searchParams.set("offset", "0");
    url.searchParams.set("postedFrom", apiDate(from.toISOString())!);
    url.searchParams.set("postedTo", apiDate(to.toISOString())!);

    let response: Response;
    try {
      response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      await sql.query(
        `update opportunities set raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object(
           'pursuitPackageCheckedAt',now(),'pursuitPackageStatus','source_unreachable',
           'pursuitPackageNote','SAM.gov did not respond during the latest package lookup. Pursuit will retry.'
         ) where id=$1`,
        [opportunityId],
      );
      return NextResponse.json({ ok: false, error: "SAM search timed out" }, { status: 502 });
    }

    if (!response.ok) {
      await sql.query(
        `update opportunities set raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object(
           'pursuitPackageCheckedAt',now(),'pursuitPackageStatus',$2,
           'pursuitPackageNote',$3
         ) where id=$1`,
        [
          opportunityId,
          `source_http_${response.status}`,
          response.status === 429
            ? "SAM.gov rate-limited the latest package lookup. Pursuit will retry; the original SAM notice remains available from the source link."
            : `SAM.gov returned HTTP ${response.status} during the latest package lookup.`,
        ],
      );
      return NextResponse.json({ ok: false, error: `SAM search returned ${response.status}` }, { status: 207 });
    }

    const body = await response.json() as SamSearchResponse;
    const record = body.opportunitiesData?.find(item => item.noticeId === opp.external_id) || body.opportunitiesData?.[0];
    links = validLinks(record?.resourceLinks || []);
    source = "sam_public_api";
  }

  let inserted = 0;
  for (const link of links) {
    const result = await sql.query(
      `insert into opportunity_documents(opportunity_id,document_type,filename,source_url,referenced_by,extraction_status)
       select $1,'sam_resource',$2,$3,'SAM.gov resourceLinks','cataloged'
       where not exists(select 1 from opportunity_documents where opportunity_id=$1 and source_url=$3)
       returning id`,
      [opportunityId, filename(link), link],
    ) as Array<{ id: string }>;
    inserted += result.length;
  }

  await sql.query(
    `update opportunities set raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object(
       'pursuitPackageCheckedAt',now(),'pursuitPackageStatus',$2,'pursuitPackageNote',$3
     ) where id=$1`,
    [
      opportunityId,
      links.length ? "public_attachments_found" : "scanned_no_public_attachment",
      links.length
        ? `SAM.gov package lookup found ${links.length} public attachment link${links.length === 1 ? "" : "s"}.`
        : "The latest authoritative SAM.gov opportunity record exposes no public resourceLinks. Controlled or login-gated attachments may still be available on the original SAM notice.",
    ],
  );

  const docs = await sql.query(
    `select id from opportunity_documents
     where opportunity_id=$1 and storage_key is null and coalesce(is_missing,false)=false
     order by case
       when lower(filename)~'(rfp|rfq|ifb|itb|solicitation|scope|statement of work|sow|spec|requirements)' then 0
       when lower(filename)~'(addend|amend|questions|answers|q&a)' then 1
       else 9 end,filename asc
     limit 8`,
    [opportunityId],
  ) as Array<{ id: string }>;

  for (const doc of docs) {
    await sql.query(
      `insert into document_jobs(document_id,stage,host_class,priority,state,attempts,max_attempts,run_after,meta)
       values($1,'acquire','sam_public',0,'pending',0,5,now(),jsonb_build_object('reason','go_no_go','organizationId',$2,'opportunityId',$3))
       on conflict(document_id,stage) do update set
         state='pending',host_class='sam_public',priority=0,run_after=now(),leased_until=null,lease_owner=null,
         attempts=case when document_jobs.state='dead' then 0 else document_jobs.attempts end,
         meta=coalesce(document_jobs.meta,'{}'::jsonb)||excluded.meta,updated_at=now()`,
      [doc.id, organizationId, opportunityId],
    );
  }

  return NextResponse.json({ ok: true, opportunityId, source, resourceLinks: links.length, inserted, queued: docs.length });
}
