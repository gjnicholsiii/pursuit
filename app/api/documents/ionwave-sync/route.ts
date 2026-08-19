import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function clean(value:string){ return value.replace(/\s+/g," ").trim(); }

export async function GET(){
  const sql=getSql();
  const opps=await sql.query(`
    select o.id,o.external_id,o.source_url
    from opportunities o
    join sources s on s.id=o.source_id
    where s.adapter_key='ionwave_k12'
      and o.status='open'
      and (o.due_at is null or o.due_at>=now())
    order by case when o.source_url like 'https://lisd.ionwave.net/%' then 0 else 1 end,
             o.due_at asc nulls last
    limit 12
  `) as Array<{id:string;external_id:string;source_url:string}>;

  const results:Array<Record<string,unknown>>=[];
  let insertedTotal=0;
  for(const opp of opps){
    try{
      const response=await fetch(opp.source_url,{redirect:'follow',cache:'no-store',headers:{'user-agent':'Pursuit/1.0 procurement document indexer',accept:'text/html,application/xhtml+xml,*/*'}});
      if(!response.ok){ results.push({externalId:opp.external_id,status:response.status,inserted:0}); continue; }
      const html=await response.text(); const $=cheerio.load(html);
      let inserted=0; let publicCount=0; let restrictedCount=0;
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
        const result=await sql.query(`
          insert into opportunity_documents(opportunity_id,document_type,filename,source_url,referenced_by,extraction_status,is_missing)
          select $1,'ionwave_attachment',$2,$3,$4,'pending',false
          where not exists(select 1 from opportunity_documents where opportunity_id=$1 and source_url=$3)
          returning id
        `,[opp.id,filename,url,`IonWave public attachment${description?`: ${description}`:''}${size?` [${size}]`:''}`]) as Array<{id:string}>;
        inserted+=result.length;
      }
      insertedTotal+=inserted;
      results.push({externalId:opp.external_id,status:response.status,publicCount,restrictedCount,inserted});
    }catch(error){ results.push({externalId:opp.external_id,error:error instanceof Error?error.message:String(error),inserted:0}); }
  }
  return NextResponse.json({ok:true,opportunities:opps.length,insertedTotal,results});
}
