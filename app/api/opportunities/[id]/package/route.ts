import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { getCurrentCustomerProfile } from "@/lib/customer-profile";

export const dynamic="force-dynamic";
export const maxDuration=30;

export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const profile=await getCurrentCustomerProfile();
  const target=new URL(`/opportunities/${id}`,request.url);
  if(!profile){target.searchParams.set("package","profile-required");return NextResponse.redirect(target,303)}
  const sql=getSql();
  const rows=await sql.query(`select o.id,s.adapter_key,s.source_family from opportunities o join sources s on s.id=o.source_id where o.id=$1 and o.status='open' and (o.due_at is null or o.due_at>=now()) limit 1`,[id]) as Array<{id:string;adapter_key:string;source_family:string}>;
  if(!rows[0]){target.searchParams.set("package","unavailable");return NextResponse.redirect(target,303)}
  const source=rows[0];
  const hostClass=source.adapter_key==='sam_gov'?'sam':source.adapter_key.includes('opengov')?'opengov':source.adapter_key.includes('ionwave')?'ionwave':source.source_family==='sled'?'sled':'other';
  const result=await sql.query(`insert into document_jobs(document_id,stage,host_class,priority,state,attempts,max_attempts,run_after,meta)
    select d.id,'acquire',$2,20,'pending',0,5,now(),jsonb_build_object('reason','complete_package','organizationId',$3,'opportunityId',$1)
    from opportunity_documents d
    where d.opportunity_id=$1 and d.storage_key is null and coalesce(d.is_missing,false)=false
    on conflict(document_id,stage) do update set
      state=case when document_jobs.state in ('done','leased') then document_jobs.state else 'pending' end,
      host_class=excluded.host_class,priority=least(document_jobs.priority,excluded.priority),run_after=now(),
      leased_until=case when document_jobs.state='leased' then document_jobs.leased_until else null end,
      lease_owner=case when document_jobs.state='leased' then document_jobs.lease_owner else null end,
      attempts=case when document_jobs.state='dead' then 0 else document_jobs.attempts end,
      meta=coalesce(document_jobs.meta,'{}'::jsonb)||excluded.meta,updated_at=now()
    returning document_id`,[id,hostClass,profile.organizationId]) as Array<{document_id:string}>;
  target.searchParams.set("package",result.length?"queued":"ready");
  return NextResponse.redirect(target,303);
}
