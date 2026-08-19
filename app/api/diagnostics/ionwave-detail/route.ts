import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const sql = getSql();
  const opps = await sql.query(`select o.id,o.external_id,o.source_url from opportunities o join sources s on s.id=o.source_id where s.adapter_key='ionwave_k12' and o.status='open' order by o.external_id limit 20`) as Array<{id:string;external_id:string;source_url:string}>;
  const results=[] as Array<Record<string,unknown>>;
  for (const opp of opps) {
    try {
      const response=await fetch(opp.source_url,{redirect:'follow',cache:'no-store',headers:{'user-agent':'Pursuit/1.0 procurement document indexer',accept:'text/html,application/xhtml+xml,*/*'}});
      const html=await response.text(); const $=cheerio.load(html);
      const attachments=$("#ctl00_mainContent_rgBidAttachments_ctl00 tr.rgRow, #ctl00_mainContent_rgBidAttachments_ctl00 tr.rgAltRow").map((_,row)=>{
        const cells=$(row).find('td');
        const filename=$(cells[0]).text().replace(/\(please login to view this document\)/i,'').replace(/\s+/g,' ').trim();
        const description=$(cells[1]).text().replace(/\s+/g,' ').trim();
        const fileSize=$(cells[2]).text().replace(/\s+/g,' ').trim();
        const bidAttachmentId=$(cells[3]).text().trim()||null;
        const companyAttachmentId=$(cells[4]).text().trim()||null;
        const link=$(cells[0]).find('a[href]').first().attr('href')||null;
        const onclick=$(cells[0]).find('[onclick]').first().attr('onclick')||null;
        const restricted=/please login to view this document/i.test($(cells[0]).text());
        return {filename,description,fileSize,bidAttachmentId,companyAttachmentId,link,onclick,restricted};
      }).get();
      results.push({externalId:opp.external_id,status:response.status,title:$('title').text().trim(),attachments});
    } catch(error) { results.push({externalId:opp.external_id,error:error instanceof Error?error.message:String(error)}); }
  }
  return NextResponse.json({count:results.length,results});
}
