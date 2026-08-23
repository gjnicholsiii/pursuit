import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic="force-dynamic";
export const maxDuration=60;

export async function GET(request:NextRequest){
  const secret=process.env.CRON_SECRET;
  if(!secret)return NextResponse.json({ok:false,error:"CRON_SECRET is not configured"},{status:503});
  if(request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  const sql=getSql();
  const retired=await sql.query(`
    with doomed as (
      select d.id,d.opportunity_id
      from document_jobs j
      join opportunity_documents d on d.id=j.document_id
      join opportunities o on o.id=d.opportunity_id
      where j.stage='acquire' and j.state='dead'
        and j.last_error in ('http_400','http_401','http_403','http_404','http_410','invalid_payload')
        and d.storage_key is null and coalesce(d.is_missing,false)=false
        and o.status='open' and (o.due_at is null or o.due_at>=now())
      limit 500
    ), updated as (
      update opportunity_documents d
      set is_missing=true,
          extraction_status='unavailable'
      from doomed x
      where d.id=x.id
      returning d.id,d.opportunity_id
    )
    select count(*)::int retired,count(distinct opportunity_id)::int opportunities from updated
  `) as Array<{retired:number;opportunities:number}>;
  await sql.query(`
    update opportunities o set raw_payload=coalesce(o.raw_payload,'{}'::jsonb)||jsonb_build_object(
      'pursuitPackageCheckedAt',now(),
      'pursuitPackageStatus','retry_discovery',
      'pursuitPackageNote','Previously cataloged package links became unavailable; source discovery will retry.'
    )
    where o.status='open' and (o.due_at is null or o.due_at>=now())
      and exists(select 1 from opportunity_documents d where d.opportunity_id=o.id and d.is_missing=true)
      and not exists(select 1 from opportunity_documents d where d.opportunity_id=o.id and coalesce(d.is_missing,false)=false)
  `);
  return NextResponse.json({ok:true,...(retired[0]||{retired:0,opportunities:0})});
}
