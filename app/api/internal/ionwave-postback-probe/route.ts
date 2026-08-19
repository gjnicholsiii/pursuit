import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
export const dynamic="force-dynamic"; export const maxDuration=60;
function hidden($: cheerio.CheerioAPI){const p=new URLSearchParams(); $('input[type=hidden][name]').each((_,e)=>p.set($(e).attr('name')||'',$(e).attr('value')||'')); return p;}
export async function GET(){
 const url='https://houstonisd.ionwave.net/SourcingEvents.aspx?SourceType=1';
 const headers={'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36','accept':'text/html,application/xhtml+xml'};
 const r=await fetch(url,{headers,cache:'no-store'}); const cookie=r.headers.get('set-cookie')||''; const html=await r.text(); const $=cheerio.load(html);
 const grid=$('[id$="rgBidList"]').first(); const gridId=grid.attr('id')||''; const unique=gridId.replace(/_/g,'$');
 const rows=$('tr[id*="rgBidList_ctl00__"]'); const rowId=rows.first().attr('id')||''; const idx=(rowId.match(/__(\d+)$/)||[])[1]||'0';
 const p=hidden($); p.set('__EVENTTARGET',unique); p.set('__EVENTARGUMENT',`RowClick;${idx}`); p.delete('__VIEWSTATEENCRYPTED');
 const post=await fetch(url,{method:'POST',headers:{...headers,'content-type':'application/x-www-form-urlencoded','referer':url,'cookie':cookie.split(',').map(x=>x.split(';')[0]).join('; ')},body:p.toString(),redirect:'manual',cache:'no-store'});
 const body=await post.text(); const links=[...body.matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1]).filter(x=>/download|attachment|document|file|bid/i.test(x)).slice(0,30);
 return NextResponse.json({getStatus:r.status,gridId,unique,rowId,idx,postStatus:post.status,location:post.headers.get('location'),length:body.length,title:(body.match(/<title[^>]*>([^<]+)/i)||[])[1]||null,links,head:body.slice(0,1000)});
}