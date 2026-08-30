import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";
const FILE_RE = /\.(pdf|docx?|xlsx?|csv|zip|txt)(?:$|[?#])/i;
const STRONG_DOWNLOAD_RE = /download\.jsp|attachment[_-]?id=|downloadFile(?:Nbr)?=|\/attachments?(?:\/|\?|$)|\/documents?(?:\/|\?|$)|\/files?(?:\/|\?|$)|\/download(?:\/|\?|$)/i;
const REJECT_RE = /\.(?:js|css|png|jpe?g|gif|svg|ico|webp|bmp|avif)(?:$|[?#])|\/(?:favicon|apple-touch-icon)(?:[-._/]|$)|\/signin(?:[/?]|$)|\/login(?:[/?]|$)|GenerateSearchPdf|\/solicitations\/?(?:\?|$)|\/solicitations\/details\/?(?:\?|$)|\/solicitations\/details\/(?:bid|existingbid)\/?(?:\?|$)|\/solicitations\/details\/~\/?(?:\?|$)/i;
const RUN_BUDGET_MS = 210_000;

type Row = { id:string; external_id:string|null; source_url:string; adapter_key:string; raw_payload:Record<string,unknown>|null };
type Found = { url:string; filename:string };
type FetchHeaders = Record<string,string>;

function safeName(value:string){return value.replace(/[^a-zA-Z0-9._() -]+/g,"-").replace(/\s+/g," ").trim().slice(0,500)||"package-document"}
function absolute(base:string,value:string){try{const u=new URL(value,base);return /^https?:$/.test(u.protocol)?u.toString():null}catch{return null}}
function sameResource(a:string,b:string){try{const x=new URL(a),y=new URL(b);return x.origin===y.origin&&x.pathname.replace(/\/$/,"")===y.pathname.replace(/\/$/,"")&&x.search===y.search}catch{return a===b}}
function isStrongDocumentUrl(url:string){return FILE_RE.test(url)||STRONG_DOWNLOAD_RE.test(url)}
function cookieHeader(response:Response){const values=typeof response.headers.getSetCookie==="function"?response.headers.getSetCookie():[];const fallback=response.headers.get("set-cookie");return (values.length?values:fallback?[fallback]:[]).map(v=>v.split(";",1)[0]).filter(Boolean).join("; ")}
function add(found:Map<string,Found>,base:string,raw:string,label?:string){
  const cleaned=raw.replace(/&amp;/g,"&").replace(/\\u0026/g,"&").trim();
  const url=absolute(base,cleaned);if(!url)return;
  if(REJECT_RE.test(url)||sameResource(base,url)||!isStrongDocumentUrl(url))return;
  let filename=label||"";
  try{const u=new URL(url);filename=filename||u.searchParams.get("filename")||u.searchParams.get("fileName")||u.searchParams.get("attachment_name")||decodeURIComponent(u.pathname.split("/").filter(Boolean).pop()||"")}catch{}
  if(REJECT_RE.test(filename))return;
  if(/^(sign in|log in|solicitations?|respond to solicitation|submit a bid|existing bid|-)?$/i.test(filename.trim()))filename="package-document";
  found.set(url,{url,filename:safeName(filename||"package-document")});
}
function walkJson(value:unknown,base:string,found:Map<string,Found>,label=""){
  if(typeof value==="string"){if(/^https?:\/\//i.test(value)||/^\//.test(value)||STRONG_DOWNLOAD_RE.test(value))add(found,base,value,label);return}
  if(Array.isArray(value)){for(const item of value)walkJson(item,base,found,label);return}
  if(!value||typeof value!=="object")return;
  for(const [key,item] of Object.entries(value as Record<string,unknown>))walkJson(item,base,found,key)
}
function extractText(body:string,base:string,found:Map<string,Found>){
  try{walkJson(JSON.parse(body),base,found)}catch{}
  const $=cheerio.load(body);
  $("a[href],iframe[src],[data-url],[data-href],form[action]").each((_,node)=>{const el=$(node);const raw=el.attr("href")||el.attr("src")||el.attr("data-url")||el.attr("data-href")||el.attr("action")||"";add(found,base,raw,el.text().replace(/\s+/g," ").trim())});
  $("[onclick],[onmousedown],[onchange]").each((_,node)=>{const el=$(node);const script=[el.attr("onclick"),el.attr("onmousedown"),el.attr("onchange")].filter(Boolean).join(" ");for(const match of script.matchAll(/(?:https?:\/\/[^"'<>\s\\]+|(?:\.\.\/|\.\/|\/)?(?:[^"'<>\s]+\/)?download\.jsp\?[^"'<>\s)]+|(?:\.\.\/|\.\/|\/)?[^"'<>\s]*attachment[_-]?id=[^"'<>\s)]+)/gi))add(found,base,match[0],el.text().replace(/\s+/g," ").trim())});
  for(const match of body.matchAll(/https?:\/\/[^"'<>\s\\]+/g))add(found,base,match[0]);
  for(const match of body.matchAll(/["']((?:\.\.\/|\.\/|\/)?[^"']{0,600}(?:download\.jsp|attachment[_-]?id=|downloadFile(?:Nbr)?=)[^"']*)["']/gi))add(found,base,match[1]);
  for(const match of body.matchAll(/["'](\/[^"']{2,600}(?:\/attachments?\/|\/documents?\/|\/files?\/)[^"']*)["']/gi))add(found,base,match[1]);
}
async function fetchBody(url:string,options:RequestInit={}){try{const response=await fetch(url,{...options,cache:"no-store",redirect:"follow",signal:AbortSignal.timeout(7000),headers:{"user-agent":UA,accept:"application/json,text/html,application/xhtml+xml,*/*",...(options.headers||{})}});const body=await response.text();return{status:response.status,url:response.url||url,body,contentType:response.headers.get("content-type")||"",cookie:cookieHeader(response)}}catch{return{status:0,url,body:"",contentType:"",cookie:""}}}
async function evaSession():Promise<FetchHeaders>{const landing=await fetchBody("https://mvendor.cgieva.com/Vendor/public/AllOpportunities.jsp");if(landing.status!==200)return{};return{referer:landing.url,...(landing.cookie?{cookie:landing.cookie}:{})}}
async function persist(row:Row,found:Map<string,Found>,reference:string){const sql=getSql();let inserted=0;for(const item of [...found.values()].slice(0,60)){const result=await sql.query(`insert into opportunity_documents(opportunity_id,document_type,filename,source_url,referenced_by,extraction_status) select $1::uuid,'sled_resource',$2,$3,$4,'cataloged' where not exists(select 1 from opportunity_documents where opportunity_id=$1::uuid and source_url=$3) returning id`,[row.id,item.filename,item.url,reference]) as Array<{id:string}>;inserted+=result.length}return inserted}
async function mark(row:Row,status:string,note?:string){await getSql().query(`update opportunities set raw_payload=coalesce(raw_payload,'{}'::jsonb)||jsonb_build_object('pursuitPackageCheckedAt',now(),'pursuitPackageStatus',$2::text,'pursuitPackageNote',$3::text) where id=$1::uuid`,[row.id,status,note||""])}

async function recoverFlorida(row:Row){
  const id=String((row.raw_payload||{}).advertisementId||row.external_id||"").trim();
  if(!id)return{inserted:0,status:"invalid_source_identity"};
  const candidates=[
    `https://vendor.myfloridamarketplace.com/mfmp/pub/search/bids/detail?advertisementId=${encodeURIComponent(id)}`,
    `https://vendor.myfloridamarketplace.com/mfmp/pub/search/bids/detail?id=${encodeURIComponent(id)}`,
    `https://vendor.myfloridamarketplace.com/mfmp/pub/search/bids/detail/${encodeURIComponent(id)}`,
    row.source_url,
  ];
  const found=new Map<string,Found>();let bestStatus=0;const diagnostics:Array<{status:number;type:string}>=[];
  for(const candidate of candidates){const res=await fetchBody(candidate);diagnostics.push({status:res.status,type:res.contentType});if(res.status===200){bestStatus=200;extractText(res.body,res.url,found)}else if(!bestStatus)bestStatus=res.status}
  const inserted=await persist(row,found,"Florida MFMP public package recovery");
  const status=found.size?"public_attachments_found":bestStatus===401||bestStatus===403?"access_required":bestStatus===200?"scanned_no_public_attachment":bestStatus?`source_http_${bestStatus}`:"source_unreachable";
  await mark(row,status,found.size?`${found.size} verified file/download links discovered`:`Florida package probe returned ${diagnostics.map(d=>d.status).join(',')}`);
  return{inserted,status,found:found.size};
}

async function recoverHtmlSource(row:Row){
  if(row.adapter_key==='powerpages_nc'){await mark(row,"access_required","NC eVP attachment records require vendor portal permission");return{inserted:0,status:"access_required",found:0,http:200}}
  const headers=row.adapter_key==='eva_vbo_va'?await evaSession():{};
  const res=await fetchBody(row.source_url,{headers});const found=new Map<string,Found>();if(res.status===200)extractText(res.body,res.url,found);
  const inserted=await persist(row,found,`${row.adapter_key} public package recovery`);
  const denied=res.status===401||res.status===403||/you don.?t have permissions|sign in to view|log in to view|authentication required/i.test(res.body);
  const evaInteractive=row.adapter_key==='eva_vbo_va'&&res.status===200&&found.size===0;
  const status=found.size?"public_attachments_found":denied||evaInteractive?"access_required":res.status===200?"scanned_no_public_attachment":res.status?`source_http_${res.status}`:"source_unreachable";
  const sessionNote=row.adapter_key==='eva_vbo_va'?(headers.cookie?"eVA guest session established; ":"eVA guest session unavailable; "):"";
  const note=found.size?`${found.size} verified file/download links discovered`:evaInteractive?`${sessionNote}eVA public detail page does not expose attachment URLs to non-interactive retrieval; use authoritative source page for package access`:`${sessionNote}${denied?"Source requires vendor authentication for package access":"Public detail record scanned; no verified attachment URL exposed"}`;
  await mark(row,status,note);
  return{inserted,status,found:found.size,http:res.status,session:Boolean(headers.cookie)};
}

export async function GET(request:NextRequest){
  const auth=requireInternalAuth(request);if(auth)return auth;
  const started=Date.now();
  const deadline=started+RUN_BUDGET_MS;
  const sql=getSql();
  const rows=await sql.query(`with candidates as(select o.id::text,o.external_id,o.source_url,s.adapter_key,o.raw_payload,row_number() over(partition by s.adapter_key order by case when (o.title||' '||coalesce(o.description,''))~*'(access control|video surveillance|security system|security camera|cctv|fire alarm|nurse call|low voltage|structured cabling|intrusion|audiovisual|av systems)' then 0 else 1 end,coalesce((o.raw_payload->>'pursuitPackageCheckedAt')::timestamptz,'epoch'::timestamptz),o.due_at asc nulls last) rn from opportunities o join sources s on s.id=o.source_id where o.status in('open','active','posted') and (o.due_at is null or o.due_at>=now()) and coalesce(o.raw_payload->>'pursuitPackageStatus','')<>'access_required' and s.adapter_key in('mfmp_vip_fl','peoplesoft_ca','peoplesoft_mn','peoplesoft_ks','cgi_advantage_mi','cgi_advantage_wv','cgi_advantage_ky','cgi_advantage_co','cgi_advantage_legacy_me','eva_vbo_va','hands_hi','south_carolina_scbo_sc','delaware_open_bids_de','esm_posting_board_sd','ivalua_app_az','powerpages_nc') and not exists(select 1 from opportunity_documents d where d.opportunity_id=o.id and coalesce(d.is_missing,false)=false)) select id,external_id,source_url,adapter_key,raw_payload from candidates where rn<=4 order by adapter_key,rn limit 48`) as Row[];
  const results=[] as Array<Record<string,unknown>>;
  const concurrency=4;
  for(let i=0;i<rows.length&&Date.now()<deadline;i+=concurrency){results.push(...await Promise.all(rows.slice(i,i+concurrency).map(async row=>row.adapter_key==='mfmp_vip_fl'?{adapter:row.adapter_key,id:row.id,...await recoverFlorida(row)}:{adapter:row.adapter_key,id:row.id,...await recoverHtmlSource(row)})))}
  await sql.query(`insert into document_jobs(document_id,stage,host_class,priority,state,attempts,max_attempts,run_after,meta) select d.id,'acquire','sled',1,'pending',0,5,now(),jsonb_build_object('reason','platform_package_recovery') from opportunity_documents d join opportunities o on o.id=d.opportunity_id where d.referenced_by like '%public package recovery%' and d.storage_key is null and coalesce(d.is_missing,false)=false and o.status in('open','active','posted') on conflict(document_id,stage) do update set state=case when document_jobs.state in('dead','skipped') then 'pending' else document_jobs.state end,priority=least(document_jobs.priority,1),run_after=case when document_jobs.state in('dead','skipped') then now() else document_jobs.run_after end,attempts=case when document_jobs.state='dead' then 0 else document_jobs.attempts end,last_error=case when document_jobs.state in('dead','skipped') then null else document_jobs.last_error end,updated_at=now()`);
  return NextResponse.json({ok:true,checked:results.length,selected:rows.length,elapsedMs:Date.now()-started,inserted:results.reduce((n,r)=>n+Number(r.inserted||0),0),results});
}