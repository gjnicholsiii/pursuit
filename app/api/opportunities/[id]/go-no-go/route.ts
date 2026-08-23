import { after, NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { getCurrentCustomerProfile } from "@/lib/customer-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const REQUIRED_ANALYZER_VERSION=4;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentCustomerProfile();
  const target = new URL(`/opportunities/${id}`, request.url);
  if (!profile) { target.searchParams.set("goNoGo", "profile-required"); return NextResponse.redirect(target, 303); }

  const sql = getSql();
  const opportunity = await sql.query(`select o.id,s.adapter_key,s.source_family from opportunities o join sources s on s.id=o.source_id where o.id=$1 and o.status='open' and (o.due_at is null or o.due_at>=now()) limit 1`, [id]) as Array<{ id:string; adapter_key:string; source_family:string }>;
  if (!opportunity[0]) { target.searchParams.set("goNoGo", "unavailable"); return NextResponse.redirect(target, 303); }

  const source=opportunity[0];
  const hostClass=source.adapter_key==='sam_gov'?'sam':source.adapter_key.includes('opengov')?'opengov':source.adapter_key.includes('ionwave')?'ionwave':source.source_family==='sled'?'sled':'other';
  await sql.query(`insert into opportunity_decisions (organization_id,opportunity_id,decision,reason,decided_by) values ($1,$2,'analyzing','GO / NO-GO analysis requested by customer','customer')`,[profile.organizationId,id]);

  const documents = await sql.query(`select d.id,d.filename,d.document_type,d.fetched_at,d.extraction_status,coalesce(max((r.normalized_value->>'analyzer_version')::int) filter(where r.normalized_value->>'source'='document_text'),0)::int analyzer_version from opportunity_documents d left join requirements r on r.document_id=d.id where d.opportunity_id=$1 and coalesce(d.is_missing,false)=false group by d.id order by case when lower(coalesce(d.filename,'')) ~ '(rfp|rfq|ifb|itb|solicitation|request for proposal|request for quote|invitation to bid)' then 0 when lower(coalesce(d.filename,'')) ~ '(spec|scope|statement of work|sow|requirements|general conditions|special conditions)' then 1 when lower(coalesce(d.filename,'')) ~ '(addendum|amendment|questions|answers|q&a)' then 2 when lower(coalesce(d.document_type,'')) ~ '(solicitation|spec|addendum|amendment)' then 3 else 9 end,d.published_at desc nulls last,d.filename asc limit 8`, [id]) as Array<{id:string;filename:string|null;document_type:string|null;fetched_at:string|null;extraction_status:string|null;analyzer_version:number}>;

  if (!documents.length) {
    const secret=process.env.CRON_SECRET;
    if(secret){const origin=process.env.VERCEL_PROJECT_PRODUCTION_URL?`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`:request.nextUrl.origin;const path=source.adapter_key==='sam_gov'?'/api/documents/sam-discover':'/api/documents/discover';const discovery=new URL(path,origin);discovery.searchParams.set('opportunityId',id);discovery.searchParams.set('organizationId',profile.organizationId);after(async()=>{try{await fetch(discovery,{cache:'no-store',headers:{authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(240_000)})}catch{}});target.searchParams.set("goNoGo", "discovering");}else target.searchParams.set("goNoGo", "package-not-found");return NextResponse.redirect(target, 303);
  }

  for (const document of documents) {
    if (!document.fetched_at) {
      await sql.query(`insert into document_jobs(document_id,stage,host_class,priority,state,attempts,max_attempts,run_after,meta) values($1,'acquire',$2,0,'pending',0,5,now(),jsonb_build_object('reason','go_no_go','organizationId',$3,'opportunityId',$4)) on conflict(document_id,stage) do update set state='pending',host_class=excluded.host_class,priority=0,run_after=now(),leased_until=null,lease_owner=null,attempts=case when document_jobs.state='dead' then 0 else document_jobs.attempts end,meta=coalesce(document_jobs.meta,'{}'::jsonb)||excluded.meta,updated_at=now()`,[document.id,hostClass,profile.organizationId,id]);
      continue;
    }
    if (!['analyzed','text_extracted'].includes(document.extraction_status || '')) {
      await sql.query(`insert into document_jobs(document_id,stage,host_class,priority,state,attempts,max_attempts,run_after,meta) values($1,'extract',$2,0,'pending',0,5,now(),jsonb_build_object('reason','go_no_go','organizationId',$3,'opportunityId',$4)) on conflict(document_id,stage) do update set state=case when document_jobs.state='done' then 'done' else 'pending' end,host_class=excluded.host_class,priority=0,run_after=now(),leased_until=null,lease_owner=null,meta=coalesce(document_jobs.meta,'{}'::jsonb)||excluded.meta,updated_at=now()`,[document.id,hostClass,profile.organizationId,id]);
      continue;
    }
    if (Number(document.analyzer_version||0) < REQUIRED_ANALYZER_VERSION) {
      await sql.query(`insert into document_jobs(document_id,stage,host_class,priority,state,attempts,max_attempts,run_after,meta) values($1,'analyze',$2,0,'pending',0,5,now(),jsonb_build_object('reason','go_no_go','organizationId',$3,'opportunityId',$4,'requiredAnalyzerVersion',$5)) on conflict(document_id,stage) do update set state='pending',host_class=excluded.host_class,priority=0,run_after=now(),leased_until=null,lease_owner=null,attempts=0,last_error=null,meta=coalesce(document_jobs.meta,'{}'::jsonb)||excluded.meta,updated_at=now()`,[document.id,hostClass,profile.organizationId,id,REQUIRED_ANALYZER_VERSION]);
    }
  }

  target.searchParams.set("goNoGo","queued");
  return NextResponse.redirect(target,303);
}
