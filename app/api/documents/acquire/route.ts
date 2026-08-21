import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

interface PendingDocumentRow { job_id:string; id:string; opportunity_id:string; source_url:string; opportunity_source_url:string; filename:string; source_family:string; host_class:string; priority:number; }
function filenameFromDisposition(value:string|null){ if(!value)return null; const utf8=value.match(/filename\*=UTF-8''([^;]+)/i); if(utf8?.[1]){try{return decodeURIComponent(utf8[1]);}catch{return utf8[1];}} return value.match(/filename="?([^";]+)"?/i)?.[1]||null; }
function safeFilename(value:string){return value.replace(/\+/g," ").replace(/[^a-zA-Z0-9._() -]+/g,"-").replace(/\s+/g," ").trim()||"document";}
function looksValid(bytes:ArrayBuffer,contentType:string,filename:string){const head=String.fromCharCode(...new Uint8Array(bytes.slice(0,8)));const lowerType=contentType.toLowerCase();const lowerName=filename.toLowerCase();if(lowerType.includes("text/html")||/^\s*</.test(head))return false;if(lowerName.endsWith(".pdf")||lowerType.includes("application/pdf"))return head.startsWith("%PDF");if(/\.(docx|xlsx|pptx|zip)$/i.test(lowerName))return head.startsWith("PK");return bytes.byteLength>0;}
async function finishJob(jobId:string){const sql=getSql();await sql.query(`update document_jobs set state='done',leased_until=null,lease_owner=null,updated_at=now() where id=$1::bigint`,[jobId]);}
async function failJob(jobId:string,error:string,permanent=false){const sql=getSql();await sql.query(permanent?`update document_jobs set state='dead',attempts=max_attempts,leased_until=null,lease_owner=null,last_error=$2,updated_at=now() where id=$1::bigint`:`update document_jobs set state=case when attempts>=max_attempts then 'dead' else 'pending' end,run_after=now()+(interval '1 second'*least(600,power(2,attempts))),leased_until=null,lease_owner=null,last_error=$2,updated_at=now() where id=$1::bigint`,[jobId,error.slice(0,1000)]);}
function cookieHeader(headers:Headers){
  const extended=headers as Headers & {getSetCookie?:()=>string[]};
  const values=extended.getSetCookie?.() || (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
  const cookies:string[]=[];
  for(const value of values){
    const matches=value.match(/(?:^|,\s*)([A-Za-z0-9_.-]+=[^;,\s]+)/g) || [];
    for(const match of matches){const cleaned=match.replace(/^,\s*/,""); if(cleaned && !cookies.includes(cleaned))cookies.push(cleaned);}
  }
  return cookies.join("; ");
}
async function fetchDocument(document:PendingDocumentRow,signal:AbortSignal){
  const baseHeaders={"User-Agent":"Pursuit/1.0 procurement document indexer",Accept:"*/*"};
  if(document.host_class==="sam"){
    const apiKey=process.env.SAM_GOV_API_KEY;
    if(apiKey && /sam\.gov\/api\/prod\/opps\/v3\/opportunities\/resources\/files\//i.test(document.source_url)){
      const url=new URL(document.source_url);
      if(!url.searchParams.has("api_key"))url.searchParams.set("api_key",apiKey);
      return fetch(url,{redirect:"follow",signal,headers:baseHeaders,cache:"no-store"});
    }
    return fetch(document.source_url,{redirect:"follow",signal,headers:baseHeaders,cache:"no-store"});
  }
  if(document.host_class!=="ionwave") return fetch(document.source_url,{redirect:"follow",signal,headers:baseHeaders,cache:"no-store"});

  try{
    const bootstrap=await fetch(document.opportunity_source_url,{redirect:"follow",signal,headers:{...baseHeaders,Accept:"text/html,application/xhtml+xml,*/*"},cache:"no-store"});
    const cookie=cookieHeader(bootstrap.headers);
    const headers:Record<string,string>={...baseHeaders,Referer:bootstrap.url || document.opportunity_source_url};
    if(cookie)headers.Cookie=cookie;
    return fetch(document.source_url,{redirect:"follow",signal,headers,cache:"no-store"});
  }catch{
    return fetch(document.source_url,{redirect:"follow",signal,headers:{...baseHeaders,Referer:document.opportunity_source_url},cache:"no-store"});
  }
}
async function acquireOne(document:PendingDocumentRow){const sql=getSql();const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);try{const response=await fetchDocument(document,controller.signal);if(!response.ok){const permanent=[400,401,403,404,410].includes(response.status);await sql.query(`update opportunity_documents set extraction_status=$2 where id=$1`,[document.id,permanent?'fetch_failed':'pending']);await failJob(document.job_id,`http_${response.status}`,permanent);return{ok:false,documentId:document.id,status:response.status};}const contentLength=Number(response.headers.get("content-length")||0);if(contentLength>MAX_DOCUMENT_BYTES){await sql.query(`update opportunity_documents set extraction_status='fetch_too_large' where id=$1`,[document.id]);await failJob(document.job_id,"too_large_50mb",true);return{ok:false,documentId:document.id,status:413};}const bytes=await response.arrayBuffer();if(bytes.byteLength>MAX_DOCUMENT_BYTES){await sql.query(`update opportunity_documents set extraction_status='fetch_too_large' where id=$1`,[document.id]);await failJob(document.job_id,"too_large_50mb",true);return{ok:false,documentId:document.id,status:413};}const contentType=response.headers.get("content-type")||"application/octet-stream";const filename=safeFilename(filenameFromDisposition(response.headers.get("content-disposition"))||document.filename);if(!looksValid(bytes,contentType,filename)){await sql.query(`update opportunity_documents set extraction_status='fetch_invalid' where id=$1`,[document.id]);await failJob(document.job_id,"invalid_payload",true);return{ok:false,documentId:document.id,status:422};}const family=document.source_family==='sled'?'sled':'sam';const pathname=`${family}/${document.opportunity_id}/${document.id}/${filename}`;const blob=await put(pathname,bytes,{access:"private",contentType,addRandomSuffix:false,allowOverwrite:true});await sql.query(`update opportunity_documents set filename=$2,storage_key=$3,fetched_at=now(),extraction_status='fetched' where id=$1`,[document.id,filename,blob.pathname]);if(/\.pdf$/i.test(filename))await sql.query(`insert into document_jobs(document_id,stage,host_class,priority) values($1::uuid,'extract',$2,$3) on conflict(document_id,stage) do update set priority=least(document_jobs.priority,excluded.priority),state=case when document_jobs.state in ('done','leased') then document_jobs.state else 'pending' end,updated_at=now()`,[document.id,document.host_class,Math.max(0,document.priority-10)]);await finishJob(document.job_id);return{ok:true,documentId:document.id,bytes:bytes.byteLength};}catch(error){const message=error instanceof Error?error.message:"fetch_failed";await failJob(document.job_id,message,false);return{ok:false,documentId:document.id,reason:message};}finally{clearTimeout(timeout);}}

export async function GET(request:NextRequest){
  const unauthorized=requireInternalAuth(request); if(unauthorized)return unauthorized;
  if(!process.env.BLOB_STORE_ID)return NextResponse.json({ok:false,error:"BLOB_STORE_ID is not available to this deployment"},{status:503});
  const sql=getSql();
  await sql.query(`update document_jobs j set state='pending',attempts=0,run_after=now(),last_error=null,updated_at=now() from opportunity_documents d where j.document_id=d.id and j.stage='acquire' and j.state='failed' and j.last_error='too_large' and d.storage_key is null and d.extraction_status='fetch_too_large'`);
  await sql.query(`update opportunity_documents d set extraction_status='pending' from document_jobs j where j.document_id=d.id and j.stage='acquire' and j.state='pending' and j.last_error is null and d.storage_key is null and d.extraction_status='fetch_too_large'`);
  await sql.query(`update document_jobs j set state='dead',leased_until=null,lease_owner=null,last_error='opportunity_closed_or_expired',updated_at=now() from opportunity_documents d,opportunities o where j.document_id=d.id and d.opportunity_id=o.id and j.stage='acquire' and j.state='pending' and d.storage_key is null and d.is_missing=false and not (o.status='open' and (o.due_at is null or o.due_at>=now()))`);
  await sql.query(`insert into document_jobs(document_id,stage,host_class,priority) select d.id,'acquire',case when s.adapter_key='sam_gov' then 'sam' when s.adapter_key ilike '%opengov%' then 'opengov' when s.adapter_key ilike '%ionwave%' then 'ionwave' when s.source_family='sled' then 'sled' else 'other' end,greatest(0,100-case when o.due_at between now() and now()+interval '30 days' then 40 else 0 end-case when lower(d.filename)~'(sow|pws|statement.?of.?work|scope|specification|rfp|rfq|ifb|bid.?form|pricing|cost.?proposal|evaluation|addend|amend|questions?.?and.?answers?)' then 25 else 0 end+case when lower(d.filename)~'(w.?9|vendor.?registration|sample.?contract)' then 25 else 0 end) from opportunity_documents d join opportunities o on o.id=d.opportunity_id join sources s on s.id=o.source_id where d.extraction_status='pending' and d.storage_key is null and d.is_missing=false and o.status='open' and (o.due_at is null or o.due_at>=now()) on conflict(document_id,stage) do nothing`);
  await sql.query(`update document_jobs set state=case when attempts>=max_attempts then 'dead' else 'pending' end,run_after=now()+(interval '1 second'*least(600,power(2,attempts))),leased_until=null,lease_owner=null,last_error=coalesce(last_error,'lease expired'),updated_at=now() where state='leased' and leased_until<now()`);
  const owner=`vercel-acquire-${crypto.randomUUID()}`;
  const rows=await sql.query(`with claim as (select j.id from document_jobs j join opportunity_documents d on d.id=j.document_id join opportunities o on o.id=d.opportunity_id where j.stage='acquire' and j.state='pending' and j.run_after<=now() and d.storage_key is null and d.is_missing=false and o.status='open' and (o.due_at is null or o.due_at>=now()) order by j.priority,j.run_after,j.id limit 24 for update skip locked),leased as (update document_jobs j set state='leased',leased_until=now()+interval '10 minutes',lease_owner=$1,attempts=attempts+1,updated_at=now() from claim where j.id=claim.id returning j.id as job_id,j.document_id,j.host_class,j.priority) select leased.job_id::text,d.id,d.opportunity_id,d.source_url,o.source_url as opportunity_source_url,d.filename,s.source_family,leased.host_class,leased.priority from leased join opportunity_documents d on d.id=leased.document_id join opportunities o on o.id=d.opportunity_id join sources s on s.id=o.source_id`,[owner]) as PendingDocumentRow[];
  if(!rows.length)return NextResponse.json({ok:true,processed:0,message:"No acquisition jobs are waiting"});
  const results=[] as Array<Record<string,unknown>>;const fast=rows.filter(r=>r.host_class!=="ionwave");const slow=rows.filter(r=>r.host_class==="ionwave");for(let i=0;i<fast.length;i+=8)results.push(...await Promise.all(fast.slice(i,i+8).map(acquireOne)));for(let i=0;i<slow.length;i+=2)results.push(...await Promise.all(slow.slice(i,i+2).map(acquireOne)));const fetched=results.filter(r=>r.ok).length;return NextResponse.json({ok:true,processed:results.length,fetched,failed:results.length-fetched});
}
