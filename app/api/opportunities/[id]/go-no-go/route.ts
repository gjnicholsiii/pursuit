import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { getCurrentCustomerProfile } from "@/lib/customer-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function workerOrigin(request: NextRequest) {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return productionHost ? `https://${productionHost}` : request.nextUrl.origin;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentCustomerProfile();
  const target = new URL(`/opportunities/${id}`, request.url);

  if (!profile) {
    target.searchParams.set("goNoGo", "profile-required");
    return NextResponse.redirect(target, 303);
  }

  const sql = getSql();
  const opportunity = await sql.query(
    `select id from opportunities where id = $1 and status = 'open' and (due_at is null or due_at >= now()) limit 1`,
    [id],
  ) as Array<{ id: string }>;

  if (!opportunity[0]) {
    target.searchParams.set("goNoGo", "unavailable");
    return NextResponse.redirect(target, 303);
  }

  await sql.query(
    `update opportunity_documents
     set extraction_status = 'cataloged'
     where storage_key is null and coalesce(is_missing,false) = false and extraction_status = 'pending'`,
  );
  await sql.query(
    `update document_jobs
     set state='skipped', leased_until=null, lease_owner=null, updated_at=now()
     where state='pending'
       and stage in ('acquire','extract','analyze')
       and coalesce(meta->>'reason','') <> 'go_no_go'`,
  );

  await sql.query(
    `insert into opportunity_decisions (organization_id, opportunity_id, decision, reason, decided_by)
     values ($1,$2,'analyzing','GO / NO-GO analysis requested by customer','customer')`,
    [profile.organizationId, id],
  );

  const documents = await sql.query(
    `select id, filename, document_type, fetched_at, extraction_status
     from opportunity_documents
     where opportunity_id = $1 and coalesce(is_missing,false) = false
     order by
       case
         when lower(coalesce(filename,'')) ~ '(rfp|rfq|ifb|itb|solicitation|request for proposal|request for quote|invitation to bid)' then 0
         when lower(coalesce(filename,'')) ~ '(spec|scope|statement of work|sow|requirements|general conditions|special conditions)' then 1
         when lower(coalesce(filename,'')) ~ '(addendum|amendment|questions|answers|q&a)' then 2
         when lower(coalesce(document_type,'')) ~ '(solicitation|spec|addendum|amendment)' then 3
         else 9
       end,
       published_at desc nulls last,
       filename asc
     limit 8`,
    [id],
  ) as Array<{ id: string; filename: string | null; document_type: string | null; fetched_at: string | null; extraction_status: string | null }>;

  if (!documents.length) {
    target.searchParams.set("goNoGo", "package-not-found");
    return NextResponse.redirect(target, 303);
  }

  for (const document of documents) {
    if (!document.fetched_at) {
      await sql.query(
        `insert into document_jobs (document_id, stage, host_class, priority, state, attempts, max_attempts, run_after, meta)
         values ($1,'acquire','ondemand',0,'pending',0,5,now(),jsonb_build_object('reason','go_no_go','organizationId',$2,'opportunityId',$3))
         on conflict(document_id,stage) do update set
           state='pending', priority=0, run_after=now(), leased_until=null, lease_owner=null,
           attempts=case when document_jobs.state='dead' then 0 else document_jobs.attempts end,
           meta=coalesce(document_jobs.meta,'{}'::jsonb)||excluded.meta, updated_at=now()`,
        [document.id, profile.organizationId, id],
      );
    } else if (!['complete','extracted','analyzed'].includes(document.extraction_status || '')) {
      await sql.query(
        `insert into document_jobs (document_id, stage, host_class, priority, state, attempts, max_attempts, run_after, meta)
         values ($1,'extract','ondemand',0,'pending',0,5,now(),jsonb_build_object('reason','go_no_go','organizationId',$2,'opportunityId',$3))
         on conflict(document_id,stage) do update set
           state=case when document_jobs.state='done' then 'done' else 'pending' end,
           priority=0, run_after=now(), leased_until=null, lease_owner=null,
           meta=coalesce(document_jobs.meta,'{}'::jsonb)||excluded.meta, updated_at=now()`,
        [document.id, profile.organizationId, id],
      );
    }
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    target.searchParams.set("goNoGo", "queued");
    return NextResponse.redirect(target, 303);
  }

  try {
    const response = await fetch(new URL("/api/documents/acquire", workerOrigin(request)), {
      cache: "no-store",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(240_000),
    });
    target.searchParams.set("goNoGo", response.ok ? "processing" : "queued");
  } catch {
    target.searchParams.set("goNoGo", "queued");
  }

  return NextResponse.redirect(target, 303);
}
