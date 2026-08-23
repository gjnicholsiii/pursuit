import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function clean(value:string){ return value.replace(/\s+/g," ").trim(); }
function sleep(ms:number){ return new Promise(resolve=>setTimeout(resolve,ms)); }

async function fetchWithThrottleRetry(url:string){
  const headers={'user-agent':'Pursuit/1.0 procurement document indexer',accept:'text/html,application/xhtml+xml,*/*'};
  let response=await fetch(url,{redirect:'follow',cache:'no-store',headers});
  if(response.status!==429)return response;
  const retryAfter=Number(response.headers.get('retry-after')||0);
  const waitMs=Math.min(8000,Math.max(1500,Number.isFinite(retryAfter)&&retryAfter>0?retryAfter*1000:2500));
  await sleep(waitMs);
  response=await fetch(url,{redirect:'follow',cache:'no-store',headers});
  return response;
}

export async function GET(request:NextRequest){
  const auth=requireInternalAuth(request); if(auth)return auth;
  const sql=getSql();

  // Older generic HTML discovery interpreted ASP.NET postback control IDs such as
  // ctl00$mainContent$rgBidAttachments... as relative URLs. They are UI control
  // identifiers, not downloadable resources. Retire them here so the dedicated
  // IonWave attachment parser remains the authoritative document path.
  const retired=await sql.query(`
    with artifacts as (
      update opportunity_documents d
      set is_missing=true, extraction_status='discovery_artifact'
      from opportunities o, sources s
      where d.opportunity_id=o.id
        and o.source_id=s.id
        and s.adapter_key='ionwave_k12'
        and d.document_type='sled_resource'
        and d.storage_key is null
        and position('$' in d.source_url)>0
      returning d.id
    )
    update document_jobs j
    set state='skipped',leased_until=null,lease_owner=null,last_error=null,updated_at=now(),
        meta=coalesce(j.meta,'{}'::jsonb)||jsonb_build_object('reason','ionwave_control_id_not_document')
    from artifacts a
    where j.document_id=a.id and j.stage='acquire' and j.state in ('pending','dead')
    returning j.id
  `) as Array<{id:number}>;

  const opps=await sql.query(`
    select o.id,o.external_id,o.source_url
    from opportunities o
    join sources s on s.id=o.source_id
    where s.adapter_key='ionwave_k12'
      and o.status='open'
      and (o.due_at is null or o.due_at>=now())
    order by case when exists(
               select 1 from opportunity_documents d
               join document_jobs j on j.document_id=d.id and j.stage='acquire'
               where d.opportunity_id=o.id and d.storage_key is null and j.state in ('failed','dead')
             ) then 0 else 1 end,
             o.due_at asc nulls last,
             o.id
    limit 12
  `) as Array<{id:string;external_id:string;source_url:string}>;

  const results:Array<Record<string,unknown>>=[];
  let insertedTotal=0;
  let refreshedTotal=0;
  let revivedTotal=0;
  for(const opp of opps){
    try{
      const response=await fetchWithThrottleRetry(opp.source_url);
      if(!response.ok){ results.push({externalId:opp.external_id,status:response.status,inserted:0}); await sleep(350); continue; }
      const html=await response.text(); const $=cheerio.load(html);
      let inserted=0; let refreshed=0; let revived=0; let publicCount=0; let restrictedCount=0;
      const rows=$("#ctl00_mainContent_rgBidAttachments_ctl00 tr.rgRow, #ctl00_mainContent_rgBidAttachments_ctl00 tr.rgAltRow").toArray();
      for(const row of rows){
        const cells=$(row).find('td');
        if(cells.length<3) continue;
        const rawName=clean($(cells[0]).text());
        const filename=clean(rawName.replace(/\(please login to view this document\)/i,''));
        if(!filename) continue;
        const restricted=/please login to view this document/i.test(rawName);
        const href=$(cells[0]).find('a[href]').first().attr('href');
        if(restricted || !href){ restrictedCount++; continue; }
        let url:string;
        try{ url=new URL(href,response.url).toString(); }catch{ continue; }
        if(!/^https?:/i.test(url)) continue;
        publicCount++;
        const description=clean($(cells[1]).text());
        const size=clean($(cells[2]).text());

        const existing=await sql.query(`
          select id,source_url,storage_key
          from opportunity_documents
          where opportunity_id=$1::uuid and document_type='ionwave_attachment' and lower(filename)=lower($2::text)
          order by fetched_at desc nulls last, id
          limit 1
        `,[opp.id,filename]) as Array<{id:string;source_url:string;storage_key:string|null}>;

        if(existing[0]){
          if(!existing[0].storage_key){
            if(existing[0].source_url!==url){
              await sql.query(`update opportunity_documents set source_url=$2::text, extraction_status='pending' where id=$1::uuid`,[existing[0].id,url]);
              refreshed++;
            }
            const revivedJobs=await sql.query(`
              update document_jobs set state='pending',attempts=0,run_after=now()+interval '5 minutes',leased_until=null,lease_owner=null,last_error=null,updated_at=now()
              where document_id=$1::uuid and stage='acquire' and state in ('failed','dead') and last_error in ('http_429','http_404')
              returning id
            `,[existing[0].id]) as Array<{id:number}>;
            revived+=revivedJobs.length;
          }
          continue;
        }

        const result=await sql.query(`
          insert into opportunity_documents(opportunity_id,document_type,filename,source_url,referenced_by,extraction_status,is_missing)
          select $1,'ionwave_attachment',$2,$3,$4,'pending',false
          where not exists(select 1 from opportunity_documents where opportunity_id=$1 and document_type='ionwave_attachment' and lower(filename)=lower($2))
          returning id
        `,[opp.id,filename,url,`IonWave public attachment${description?`: ${description}`:''}${size?` [${size}]`:''}`]) as Array<{id:string}>;
        inserted+=result.length;
      }
      insertedTotal+=inserted;
      refreshedTotal+=refreshed;
      revivedTotal+=revived;
      results.push({externalId:opp.external_id,status:response.status,publicCount,restrictedCount,inserted,refreshed,revived});
      await sleep(350);
    }catch(error){ results.push({externalId:opp.external_id,error:error instanceof Error?error.message:String(error),inserted:0}); await sleep(350); }
  }
  return NextResponse.json({ok:true,opportunities:opps.length,retiredControlArtifacts:retired.length,insertedTotal,refreshedTotal,revivedTotal,results});
}
