import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FILE_EXT = /\.(pdf|docx?|xlsx?|csv|zip|txt|dotx?)(?:$|[?#])/i;
const DOC_URL_HINT = /(download|attachment|document|file|resource|solicitation|specification|addendum|amendment|bid[-_ ]?package|rfp|rfq|ifb)/i;
const DOC_TEXT_HINT = /(download|attachment|document|specification|scope of work|statement of work|solicitation|addendum|amendment|bid package|pricing|bid form|rfp|rfq|ifb)/i;
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

function safeName(url: string, fallback = "document") { try { const parsed=new URL(url);const explicit=parsed.searchParams.get("fn");const name=explicit||decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop()||fallback); return name.replace(/[^a-zA-Z0-9._() -]+/g,"-").replace(/\s+/g," ").trim()||fallback; } catch { return fallback; } }
function isHttp(value:string){try{return ["http:","https:"].includes(new URL(value).protocol)}catch{return false}}
function absolute(base:string,value:string){try{const url=new URL(value,base).toString();return isHttp(url)?url:null}catch{return null}}
function extractQuotedUrls(value:string,base:string){const urls:string[]=[];for(const match of value.matchAll(/["']([^"']{3,500})["']/g)){const raw=match[1];if(!raw||raw.startsWith("javascript:"))continue;const url=absolute(base,raw);if(url)urls.push(url)}return urls}
function norm(value:unknown){return String(value??"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function cookieHeader(response:Response){const values=typeof response.headers.getSetCookie==="function"?response.headers.getSetCookie():[];const fallback=response.headers.get("set-cookie");return (values.length?values:fallback?[fallback]:[]).map(v=>v.split(";",1)[0]).filter(Boolean).join("; ")}

type OpportunityRow={id:string;title:string;source_url:string;agency_type:string;source_name:string;adapter_key:string;external_id:string|null;raw_payload:Record<string,unknown>|null};
type ScanResult={opportunityId:string;agencyType:string;sourceName:string;discovered:number;inserted:number;status:number};
type SessionHeaders=Record<string,string>;

function identifiers(opp:OpportunityRow){const raw=opp.raw_payload||{};return [opp.external_id,raw.internalId,raw.externalSolicitationId,raw.solicitationNumber,raw.financialId].map(v=>String(v??"").trim()).filter(v=>v.length>=3)}
function scanUrls(opp:OpportunityRow){const urls=new Set<string>([opp.source_url]);const raw=opp.raw_payload||{};for(const key of ["sourcePage","detailUrl","detailURL","bidUrl","bidURL","url"]){const value=raw[key];if(typeof value==="string"&&isHttp(value))urls.add(value)}if(opp.adapter_key.startsWith("periscope_")&&opp.external_id){try{const base=new URL(opp.source_url);const root=`${base.protocol}//${base.host}/bso/`;const search=new URL("view/search/external/advancedSearchBid.xhtml",root);search.searchParams.set("currentDocType","bids");search.searchParams.set("q",opp.external_id);urls.add(search.toString())}catch{}}return [...urls].slice(0,4)}

async function sessionFor(opp:OpportunityRow):Promise<SessionHeaders>{
  if(opp.adapter_key!=="eva_vbo_va")return {};
  try{
    const landing=await fetch("https://mvendor.cgieva.com/Vendor/public/AllOpportunities.jsp",{cache:"no-store",redirect:"follow",headers:{"user-agent":UA,accept:"text/html,application/xhtml+xml"}});
    if(!landing.ok)return {};
    const cookie=cookieHeader(landing);
    return {referer:landing.url,...(cookie?{cookie}:{})};
  }catch{return {}}
}

function addPeriscopeDownload(pageUrl:string,onclick:string,text:string,discovered:Set<string>){
  const match=onclick.match(/downloadFile\s*\(\s*['\"]?(\d+)['\"]?\s*\)/i);
  if(!match)return;
  try{
    const url=new URL(pageUrl);
    if(!/\/bso\/external\/bidDetail\.sda$/i.test(url.pathname))return;
    url.searchParams.set("downloadFileNbr",match[1]);
    url.searchParams.set("mode","download");
    if(text)url.searchParams.set("fn",text);
    discovered.add(url.toString());
  }catch{}
}

async function inspectHtml(html:string,pageUrl:string,opp:OpportunityRow,discovered:Set<string>,follow:Set<string>){
  const $=cheerio.load(html);const ids=identifiers(opp).map(v=>v.toLowerCase());const titleWords=norm(opp.title).split(" ").filter(v=>v.length>4).slice(0,5);
  $("a,button,[onclick],[data-url],[data-href]").each((_,el)=>{
    const node=$(el);const text=node.text().replace(/\s+/g," ").trim();const onclick=node.attr("onclick")||"";
    if(opp.adapter_key.startsWith("periscope_"))addPeriscopeDownload(pageUrl,onclick,text,discovered);
    const hay=(text+" "+(node.attr("href")||"")+" "+onclick).toLowerCase();
    const values=[node.attr("href"),node.attr("data-url"),node.attr("data-href")].filter((v):v is string=>Boolean(v));values.push(...extractQuotedUrls(onclick,pageUrl));
    const oppSpecific=ids.some(id=>hay.includes(id))||titleWords.filter(word=>hay.includes(word)).length>=3;
    for(const raw of values){
      if(raw.startsWith("javascript:")){for(const extracted of extractQuotedUrls(raw,pageUrl)){if(FILE_EXT.test(extracted)||DOC_URL_HINT.test(extracted))discovered.add(extracted);else if(DOC_TEXT_HINT.test(text)||oppSpecific)follow.add(extracted)}continue}
      const url=absolute(pageUrl,raw);if(!url)continue;if(FILE_EXT.test(url))discovered.add(url);else if(oppSpecific)follow.add(url);else if(DOC_URL_HINT.test(url)&&DOC_TEXT_HINT.test(text||url))follow.add(url);else if(DOC_TEXT_HINT.test(text))follow.add(url)
    }
  });
  for(const match of html.matchAll(/https?:\/\/[^"'<>\s]+/g)){const url=match[0].replace(/&amp;/g,"&");if(FILE_EXT.test(url))discovered.add(url)}
}

async function fetchAndInspect(url:string,opp:OpportunityRow,discovered:Set<string>,follow:Set<string>,extraHeaders:SessionHeaders,timeoutMs=9000){const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch(url,{redirect:"follow",signal:controller.signal,cache:"no-store",headers:{"user-agent":UA,accept:"text/html,application/pdf,application/octet-stream,*/*",...extraHeaders}});if(!response.ok)return response.status;const contentType=(response.headers.get("content-type")||"").toLowerCase();if(contentType.includes("application/pdf")||contentType.includes("application/vnd.openxmlformats")||FILE_EXT.test(response.url)){discovered.add(response.url);return response.status}await inspectHtml(await response.text(),response.url,opp,discovered,follow);return response.status}catch{return 0}finally{clearTimeout(timeout)}}

async function scanOne(opp:OpportunityRow):Promise<ScanResult>{const sql=getSql();const discovered=new Set<string>();const follow=new Set<string>();let status=0;const targets=scanUrls(opp);const session=await sessionFor(opp);for(const url of targets){const current=await fetchAndInspect(url,opp,discovered,follow,session);if(!status&&current)status=current}const origins=new Set(targets.map(url=>{try{return new URL(url).origin}catch{return ""}}).filter(Boolean));let followed=0;for(const url of follow){if(followed>=12)break;try{if(!origins.has(new URL(url).origin))continue}catch{continue}followed++;const secondHop=new Set<string>();await fetchAndInspect(url,opp,discovered,secondHop,session,8000);for(const deep of secondHop){if(followed>=16)break;try{if(!origins.has(new URL(deep).origin))continue}catch{continue}followed++;await fetchAndInspect(deep,opp,discovered,new Set<string>(),session,7000)}}let inserted=0;for(const url of [...discovered].slice(0,60)){const result=await sql.query(`insert into opportunity_documents (opportunity_id, document_type, filename, source_url, referenced_by, extraction_status) select $1,'sled_resource',$2,$3,$4,'pending' where not exists (select 1 from opportunity_documents where opportunity_id=$1 and source_url=$3) returning id`,[opp.id,safeName(url,`${opp.agency_type}-document`),url,`${opp.source_name} source discovery`]) as Array<{id:string}>;inserted+=result.length}return{opportunityId:opp.id,agencyType:opp.agency_type,sourceName:opp.source_name,discovered:discovered.size,inserted,status}}

export async function GET(request:NextRequest){
  const auth=requireInternalAuth(request);if(auth)return auth;
  const sql=getSql();
  const rows=await sql.query(`
    with candidates as (
      select o.id,o.title,o.source_url,o.external_id,o.raw_payload,o.due_at,a.agency_type,s.source_name,s.adapter_key,
        row_number() over (partition by s.adapter_key order by o.due_at asc nulls last,o.last_seen_at desc) as family_rank,
        case
          when s.adapter_key like 'periscope_%' then 0
          when s.adapter_key='eva_vbo_va' then 1
          when s.adapter_key in ('nyscr_ny','peoplesoft_ca','texas_esbd_tx','powerpages_nc') then 2
          when a.agency_type='k12' then 3
          when a.agency_type='higher_ed' then 4
          else 5
        end as priority
      from opportunities o
      join agencies a on a.id=o.agency_id
      join sources s on s.id=o.source_id
      where s.source_family='sled'
        and s.adapter_key <> 'opengov_public'
        and o.status='open'
        and (o.due_at is null or o.due_at >= now())
        and not exists (select 1 from opportunity_documents d where d.opportunity_id=o.id)
    )
    select id,title,source_url,external_id,raw_payload,agency_type,source_name,adapter_key
    from candidates
    where family_rank <= 40
    order by priority,family_rank,due_at asc nulls last
    limit 240
  `) as OpportunityRow[];
  if(!rows.length)return NextResponse.json({ok:true,scannedCount:0,message:"No undiscovered open non-OpenGov SLED opportunities remain"});
  const scanned:ScanResult[]=[];
  const concurrency=6;
  for(let i=0;i<rows.length;i+=concurrency)scanned.push(...await Promise.all(rows.slice(i,i+concurrency).map(scanOne)));
  const totalInserted=scanned.reduce((sum,row)=>sum+row.inserted,0);
  const withDocuments=scanned.filter(row=>row.inserted>0).length;
  const bySource=Object.values(scanned.reduce((acc,row)=>{const key=row.sourceName;const current=acc[key]||{sourceName:key,scanned:0,withDocuments:0,inserted:0};current.scanned++;if(row.inserted>0)current.withDocuments++;current.inserted+=row.inserted;acc[key]=current;return acc},{} as Record<string,{sourceName:string;scanned:number;withDocuments:number;inserted:number}>));
  return NextResponse.json({ok:true,scannedCount:scanned.length,withDocuments,totalInserted,bySource,scanned});
}
