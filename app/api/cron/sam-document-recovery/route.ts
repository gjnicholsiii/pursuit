import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic="force-dynamic";
export const maxDuration=300;

type Row={id:string;external_id:string;issue_date:string|null;posted_date:string|null;title:string};
type SamResponse={opportunitiesData?:Array<{noticeId?:string;resourceLinks?:string[]|null}>};
const SECURITY_RE=/(access control|video surveillance|security system|security camera|cctv|fire alarm|nurse call|low voltage|structured cabling|intrusion|audiovisual|av systems)/i;
const RUN_BUDGET_MS=240_000;
const BATCH_SIZE=96;
const CONCURRENCY=4;
function apiDate(value:string|null){const d=value?new Date(value):new Date();if(Number.isNaN(d.getTime()))return null;return `${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}/${d.getUTCFullYear()}`}
function filename(url:string){try{const u=new URL(url);const explicit=u.searchParams.get('filename')||u.searchParams.get('fn');if(explicit)return explicit;const parts=u.pathname.split('/').filter(Boolean);return `SAM resource ${parts.at(-2)||parts.at(-1)||'file'}`}catch{return'SAM resource'}}

export async function GET(request:NextRequest){
 const secret=process.env.CRON_SECRET;if(!secret)return NextResponse.json({ok:false,error:'CRON_SECRET is not configured'},{status:503});if(request.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({ok:false,error:'Unauthorized'},{status:401});
 const apiKey=process.env.SAM_GOV_API_KEY;if(!apiKey)return NextResponse.json({ok:false,error:'SAM_GOV_API_KEY is not configured'},{status:503});
 const started=Date.now();const deadline=started+RUN_BUDGET_MS;const sql=getSql();
 const rows=await sql.query(`select o.id::text,o.external_id,o.issue_date::text,o.raw_payload->>'postedDate' posted_date,o.title from opportunities o join sources s on s.id=o.source_id where s.adapter_key='sam_gov' and o.status='open' and (o.due_at is null or o.due_at>=now()) and not exists(select 1 from opportunity_documents d where d.opportunity_id=o.id and coalesce(d.is_missing,false)=false) order by case when (o.title||' '||coalesce(o.description,''))~*'(access control|video surveillance|security system|security camera|cctv|fire alarm|nurse call|low voltage|structured cabling|intrusion|audiovisual|av systems)' then 0 else 1 end,coalesce((o.raw_payload->>'pursuitSamPackageCheckedAt')::timestamptz,'epoch'::timestamptz),o.due_at asc nulls last limit ${BATCH_SIZE}`) as Row[];
 let inserted=0,foundOpps=0,failed=0,checked=0,rateLimited=false;
 async function processRow(row:Row){
  if(rateLimited||Date.now()>=deadline)return;
  const posted=new Date(row.posted_date||row.issue_date||Date.now());const from=new Date(posted);from.setUTCDate(from.getUTCDate()-3);const to=new Date(posted);to.setUTCDate(to.getUTCDate()+3);
  const url=new URL('https://api.sam.gov/opportunities/v2/search');url.searchParams.set('api_key',apiKey);url.searchParams.set('noticeid',row.external_id);url.searchParams.set('limit','10');url.searchParams.set('offset','0');url.searchParams.set('postedFrom',apiDate(from.toISOString())!);url.searchParams.set('postedTo',apiDate(to.toISOString())!);
  let status='scanned_no_public_attachment';
  try{
   const response=await fetch(url,{cache:'no-store',headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
   if(response.status===429){status='rate_limited';rateLimited=true}
   else if(!response.ok){status=`source_http_${response.status}`;failed++}
   else{
    const body=await response.json() as SamResponse;const record=body.opportunitiesData?.find(item=>item.noticeId===row.external_id)||body.opportunitiesData?.[0];const links=[...new Set(record?.resourceLinks||[])].filter(link=>/^https?:\/\//i.test(link));
    if(links.length){status='public_attachments_found';foundOpps++}
    for(const link of links){const result=await sql.query(`insert into opportunity_documents(opportunity_id,document_type,filename,source_url,referenced_by,extraction_status) select $1::uuid,'sam_resource',$2,$3,'SAM.gov proactive package recovery','cataloged' where not exists(select 1 from opportunity_documents where opportunity_id=$1::uuid and source_url=$3) returning id`,[row.id,filename(link),link]) as Array<{id:string}>;inserted+=result.length}
   }
  }catch{status='source_unreachable';failed++}
  checked++;
  await sql.query(`update opportunities set raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object('pursuitSamPackageCheckedAt',now(),'pursuitPackageCheckedAt',now(),'pursuitPackageStatus',$2::text,'pursuitPackageNote',$3::text) where id=$1::uuid`,[row.id,status,SECURITY_RE.test(row.title)?'Prioritized security/low-voltage SAM package scan':'SAM package scan']);
 }
 for(let i=0;i<rows.length&&!rateLimited&&Date.now()<deadline;i+=CONCURRENCY){await Promise.all(rows.slice(i,i+CONCURRENCY).map(processRow))}
 await sql.query(`insert into document_jobs(document_id,stage,host_class,priority,state,attempts,max_attempts,run_after,meta) select d.id,'acquire','sam_public',case when (o.title||' '||coalesce(o.description,''))~*'(access control|video surveillance|security system|security camera|cctv|fire alarm|nurse call|low voltage|structured cabling|intrusion|audiovisual|av systems)' then 0 else 2 end,'pending',0,5,now(),jsonb_build_object('reason','sam_proactive_recovery') from opportunity_documents d join opportunities o on o.id=d.opportunity_id where d.referenced_by='SAM.gov proactive package recovery' and d.storage_key is null and coalesce(d.is_missing,false)=false and o.status='open' on conflict(document_id,stage) do update set host_class='sam_public',priority=least(document_jobs.priority,excluded.priority),state=case when document_jobs.state in('dead','skipped') then 'pending' else document_jobs.state end,attempts=case when document_jobs.state='dead' then 0 else document_jobs.attempts end,run_after=case when document_jobs.state in('dead','skipped') then now() else document_jobs.run_after end,updated_at=now()`);
 return NextResponse.json({ok:!rateLimited,checked,selected:rows.length,foundOpps,inserted,failed,rateLimited,elapsedMs:Date.now()-started},{status:rateLimited?207:200});
}
