import { put } from "@vercel/blob";
import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 12;
const MAX_BYTES = 32 * 1024 * 1024;

type Row = {
  job_id:string;
  document_id:string;
  opportunity_id:string;
  filename:string;
  document_url:string;
  opportunity_url:string;
};

function safeFilename(value:string){return value.replace(/\+/g," ").replace(/[^a-zA-Z0-9._() -]+/g,"-").replace(/\s+/g," ").trim()||"document"}
function normalized(value:string){return safeFilename(value).toLowerCase().replace(/\s+/g," ").trim()}
function cookieHeader(headers:Headers){const extended=headers as Headers&{getSetCookie?:()=>string[]};const values=extended.getSetCookie?.()||(headers.get("set-cookie")?[headers.get("set-cookie") as string]:[]);return values.map(v=>v.split(";",1)[0]).filter(Boolean).join("; ")}
function oldFileNbr(url:string){try{return new URL(url).searchParams.get("downloadFileNbr")||""}catch{return ""}}
function valid(bytes:ArrayBuffer,contentType:string,filename:string){const head=String.fromCharCode(...new Uint8Array(bytes.slice(0,8)));if(contentType.toLowerCase().includes("text/html")||/^\s*</.test(head))return false;if(filename.toLowerCase().endsWith(".pdf")||contentType.toLowerCase().includes("application/pdf"))return head.startsWith("%PDF");if(/\.(docx|xlsx|pptx|zip)$/i.test(filename))return head.startsWith("PK");return bytes.byteLength>0}
async function bounded(response:Response){if(!response.body)return response.arrayBuffer();const reader=response.body.getReader();const chunks:Uint8Array[]=[];let total=0;while(true){const {done,value}=await reader.read();if(done)break;if(!value)continue;total+=value.byteLength;if(total>MAX_BYTES){await reader.cancel();throw new Error("too_large_runtime_cap")}chunks.push(value)}const merged=new Uint8Array(total);let offset=0;for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.byteLength}return merged.buffer}

async function recover(row:Row){
  const sql=getSql();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),25000);
  try{
    const detail=new URL(row.opportunity_url);
    detail.searchParams.delete("downloadFileNbr");detail.searchParams.delete("mode");detail.searchParams.delete("fn");
    const page=await fetch(detail,{cache:"no-store",redirect:"follow",signal:controller.signal,headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit/1.0; +https://pursuit-neon.vercel.app)",accept:"text/html,application/xhtml+xml,*/*"}});
    if(!page.ok)return {ok:false,status:page.status,reason:"detail_fetch"};
    const cookie=cookieHeader(page.headers);const html=await page.text();const $=cheerio.load(html);const wanted=normalized(row.filename);
    let fileNbr="";
    $("a,button,[onclick]").each((_,node)=>{if(fileNbr)return;const el=$(node);const text=normalized(el.text());const raw=[el.attr("onclick")||"",el.attr("href")||""].join(" ");const match=raw.match(/downloadFile\s*\(\s*['\"]?(\d+)['\"]?\s*\)/i)||raw.match(/[?&]downloadFileNbr=(\d+)/i);if(match&&(text===wanted||text.includes(wanted)||wanted.includes(text)||normalized(raw).includes(wanted)))fileNbr=match[1]});
    if(!fileNbr){for(const match of html.matchAll(/downloadFile\s*\(\s*['\"]?(\d+)['\"]?\s*\)/gi)){const start=Math.max(0,(match.index||0)-700),end=Math.min(html.length,(match.index||0)+700);if(normalized(html.slice(start,end)).includes(wanted)){fileNbr=match[1];break}}}
    if(!fileNbr)fileNbr=oldFileNbr(row.document_url);
    if(!fileNbr)return {ok:false,status:404,reason:"attachment_unresolved"};
    const download=new URL(page.url);download.searchParams.set("downloadFileNbr",fileNbr);download.searchParams.set("mode","download");download.searchParams.set("fn",row.filename);
    const headers:Record<string,string>={"user-agent":"Mozilla/5.0 (compatible; Pursuit/1.0; +https://pursuit-neon.vercel.app)",accept:"application/pdf,application/octet-stream,*/*",referer:page.url};if(cookie)headers.cookie=cookie;
    const response=await fetch(download,{cache:"no-store",redirect:"follow",signal:controller.signal,headers});
    if(!response.ok)return {ok:false,status:response.status,reason:"attachment_fetch"};
    const bytes=await bounded(response);const contentType=response.headers.get("content-type")||"application/octet-stream";const filename=safeFilename(row.filename);
    if(!valid(bytes,contentType,filename))return {ok:false,status:422,reason:"invalid_payload"};
    const pathname=`sled/${row.opportunity_id}/${row.document_id}/${filename}`;
    const blob=await put(pathname,bytes,{access:"private",contentType,addRandomSuffix:false,allowOverwrite:true,multipart:bytes.byteLength>24*1024*1024});
    await sql.query(`update opportunity_documents set source_url=$2,filename=$3,storage_key=$4,fetched_at=now(),extraction_status='fetched' where id=$1::uuid`,[row.document_id,download.toString(),filename,blob.pathname]);
    await sql.query(`update document_jobs set state='done',leased_until=null,lease_owner=null,last_error=null,updated_at=now() where id=$1::bigint`,[row.job_id]);
    if(/\.pdf$/i.test(filename))await sql.query(`insert into document_jobs(document_id,stage,host_class,priority,state,attempts,max_attempts,run_after,meta) values($1::uuid,'extract','sled',1,'pending',0,5,now(),jsonb_build_object('reason','periscope_recovery')) on conflict(document_id,stage) do update set state=case when document_jobs.state='done' then 'done' else 'pending' end,priority=least(document_jobs.priority,1),run_after=now(),updated_at=now()`,[row.document_id]);
    return {ok:true,bytes:bytes.byteLength};
  }catch(error){return {ok:false,status:0,reason:error instanceof Error?error.message:String(error)}}finally{clearTimeout(timer)}
}

export async function GET(request:NextRequest){
  const unauthorized=requireInternalAuth(request);if(unauthorized)return unauthorized;
  if(!process.env.BLOB_STORE_ID)return NextResponse.json({ok:false,error:"BLOB_STORE_ID is not available"},{status:503});
  const sql=getSql();
  const rows=await sql.query(`select j.id::text job_id,d.id::text document_id,d.opportunity_id::text,d.filename,d.source_url document_url,o.source_url opportunity_url from document_jobs j join opportunity_documents d on d.id=j.document_id join opportunities o on o.id=d.opportunity_id join sources s on s.id=o.source_id where j.stage='acquire' and j.state='dead' and j.last_error='http_404' and s.adapter_key like 'periscope_%' and d.storage_key is null and coalesce(d.is_missing,false)=false and o.status in ('open','active','posted') and (o.due_at is null or o.due_at>=now()) order by o.due_at asc nulls last,j.id limit ${BATCH}`) as Row[];
  const results=[];for(const row of rows)results.push(await recover(row));
  const recovered=results.filter(r=>r.ok).length;
  return NextResponse.json({ok:true,processed:results.length,recovered,failed:results.length-recovered,results});
}
