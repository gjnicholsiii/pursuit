import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";

type AgencyRow={id:string;canonical_name:string;website:string};
type RankedSite={url:string;score:number};

function safePublicUrl(raw:string){
  try{
    const normalized=/^https?:\/\//i.test(raw)?raw:`https://${raw.replace(/^\/+/,"")}`;
    const url=new URL(normalized);
    if(!/^https?:$/.test(url.protocol))return null;
    const host=url.hostname.toLowerCase();
    if(host==='localhost'||host.endsWith('.local')||/^127\./.test(host)||/^10\./.test(host)||/^192\.168\./.test(host)||/^169\.254\./.test(host))return null;
    return url;
  }catch{return null;}
}

function externalFromNcesHref(href:string,base:string){
  try{
    const wrapped=new URL(href,base);
    if(/\/transfer\.asp$/i.test(wrapped.pathname)){
      const location=wrapped.searchParams.get('location');
      if(location){
        const decoded=decodeURIComponent(location).replace(/^\/+/,"");
        const candidate=safePublicUrl(decoded);
        return candidate?.toString()||null;
      }
    }
    const direct=safePublicUrl(wrapped.toString());
    if(direct&&!direct.hostname.toLowerCase().endsWith('nces.ed.gov')&&!direct.hostname.toLowerCase().endsWith('ed.gov'))return direct.toString();
  }catch{}
  return null;
}

async function fetchHtml(url:string){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(url,{cache:'no-store',redirect:'follow',signal:controller.signal,headers:{'user-agent':'Mozilla/5.0 (compatible; Pursuit-Raven/2.1)','accept':'text/html,application/xhtml+xml'}});
    if(!response.ok)return null;
    return await response.text();
  }catch{return null;}finally{clearTimeout(timer);}
}

function findOfficial(html:string,base:string):string|null{
  const $=cheerio.load(html);
  const candidates:RankedSite[]=[];
  $('a[href]').each((_,el)=>{
    const href=$(el).attr('href')||'';
    const label=$(el).text().replace(/\s+/g,' ').trim();
    const candidate=externalFromNcesHref(href,base);
    if(!candidate)return;
    let host='';
    try{host=new URL(candidate).hostname.toLowerCase();}catch{return;}
    if(/facebook|twitter|instagram|youtube|linkedin/.test(host))return;
    let score=0;
    if(/website|web site/i.test(label))score+=30;
    if(/k12|schools?|district|isd|usd|csd/i.test(`${label} ${host}`))score+=20;
    if(/\.k12\.[a-z]{2}\.us$/.test(host))score+=20;
    if(/\.org$|\.net$|\.us$/.test(host))score+=3;
    candidates.push({url:candidate,score});
  });
  candidates.sort((a,b)=>b.score-a.score);
  return candidates[0]?.url||null;
}

export async function resolveK12OfficialSites(limit=120){
  const sql=getSql();
  const rows=await sql.query(`
    select a.id::text,a.canonical_name,a.website
    from agencies a
    where a.agency_type='k12'
      and a.website ~* '^https?://nces\\.ed\\.gov/'
    order by coalesce((select max(r.started_at) from raven_enrichment_runs r where r.agency_id=a.id),'1970-01-01'::timestamptz),a.canonical_name
    limit $1
  `,[Math.max(1,Math.min(limit,160))]) as AgencyRow[];
  let resolved=0,failed=0;
  const results:Array<{agency:string;website?:string;ok:boolean}>=[];
  for(let i=0;i<rows.length;i+=12){
    const batch=rows.slice(i,i+12);
    const settled=await Promise.all(batch.map(async row=>{
      const html=await fetchHtml(row.website);
      if(!html)return{agency:row.canonical_name,ok:false};
      const official=findOfficial(html,row.website);
      if(!official)return{agency:row.canonical_name,ok:false};
      await sql.query(`update agencies set website=$2 where id=$1`,[row.id,official]);
      return{agency:row.canonical_name,website:official,ok:true};
    }));
    for(const result of settled){results.push(result);if(result.ok)resolved++;else failed++;}
  }
  return{attempted:rows.length,resolved,failed,results};
}
