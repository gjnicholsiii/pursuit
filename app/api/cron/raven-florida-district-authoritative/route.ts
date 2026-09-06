import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";
import { resolveK12OfficialSites } from "@/lib/raven/k12-official-site";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATE="FL";
const SOURCE_CLASS="fl_official_district_v2";
const RUN_BUDGET=250000;
const FETCH_TIMEOUT=7000;
const CONCURRENCY=8;
const AGENCY_LIMIT=80;
const EMAIL_RE=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
const PHONE_RE=/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
const ROLE_RX:Record<string,RegExp>={
  assistant_superintendent:/\b(?:assistant|asst\.?|deputy|associate)\s+superintendent\b/i,
  it_director:/\b(?:director|executive director|chief information officer|chief technology officer|cio|cto|technology coordinator|coordinator of (?:information )?technology)\b.{0,80}\b(?:information technology|technology|information systems|it services|network services|tech infrastructure|cybersecurity)\b|\b(?:information technology|technology|information systems|it services|network services|tech infrastructure|cybersecurity)\b.{0,80}\b(?:director|executive director|chief information officer|chief technology officer|cio|cto|coordinator)\b/i,
  school_board:/\b(?:school\s+|governing\s+)?board\s+(?:member|chair|chairman|chairwoman|president|vice president|trustee|clerk)\b|\bboard trustee\b/i,
  security_director:/\b(?:director|chief|executive director|senior director|coordinator)\b.{0,80}\b(?:security|school safety|public safety|safety and security|security and safety|emergency management|safe schools)\b|\b(?:security|school safety|public safety|safety and security|security and safety|emergency management|safe schools)\b.{0,80}\b(?:director|chief|executive director|senior director|coordinator)\b/i
};
const LINK_RX=/staff|directory|administration|leadership|cabinet|technology|information.?technology|security|safety|emergency|board|governance|district.?office|superintendent/i;
const COMMON=["/staff","/staff-directory","/directory","/administration","/leadership","/cabinet","/technology","/departments/technology","/information-technology","/security","/safety","/school-safety","/board","/school-board"];

type Agency={id:string;canonical_name:string;website:string;roles:string[]};
type Hit={role:string;fullName:string;title:string;email:string|null;phone:string|null;sourceUrl:string;score:number};

function safeUrl(raw:string){try{const u=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);if(!/^https?:$/.test(u.protocol))return null;const h=u.hostname.toLowerCase();if(h==='localhost'||h.endsWith('.local')||/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h))return null;return u;}catch{return null;}}
function host(u:URL){return u.hostname.toLowerCase().replace(/^www\./,'');}
function sameSite(a:URL,b:URL){const x=host(a),y=host(b);return x===y||x.endsWith(`.${y}`)||y.endsWith(`.${x}`);}
function clean(v:string){return v.replace(/\s+/g,' ').trim();}
function plausibleName(v:string){const s=clean(v.replace(EMAIL_RE,' ').replace(PHONE_RE,' ').replace(/[^A-Za-z.' -]/g,' '));if(s.length<5||s.length>70)return null;const p=s.split(' ').filter(Boolean);if(p.length<2||p.length>5)return null;if(/director|superintendent|technology|security|safety|board|school|district|department|office|contact|email|phone|services|president|chair|trustee|resources|news/i.test(s))return null;return p.every(x=>/^[A-Za-z][A-Za-z.'-]*$/.test(x))?s:null;}
async function fetchHtml(url:string){const c=new AbortController();const t=setTimeout(()=>c.abort(),FETCH_TIMEOUT);try{const r=await fetch(url,{redirect:'follow',cache:'no-store',signal:c.signal,headers:{'user-agent':'Mozilla/5.0 (compatible; Pursuit-Raven/5.1; authoritative-public-directory)','accept':'text/html,application/xhtml+xml'}});if(!r.ok)return null;const type=(r.headers.get('content-type')||'').toLowerCase();if(!type.includes('html'))return null;return{html:await r.text(),url:r.url||url};}catch{return null;}finally{clearTimeout(t);}}
function links(base:URL,html:string){const $=cheerio.load(html);const m=new Map<string,number>();$('a[href]').each((_,el)=>{const href=$(el).attr('href')||'';const label=clean($(el).text());try{const u=new URL(href,base);u.hash='';if(!/^https?:$/.test(u.protocol)||!sameSite(base,u))return;const text=`${label} ${u.pathname}`;if(!LINK_RX.test(text))return;let s=10;if(/staff|directory|leadership|administration|cabinet/i.test(text))s+=10;if(/technology|security|safety|board|superintendent/i.test(text))s+=20;m.set(u.toString(),Math.max(m.get(u.toString())||0,s));}catch{}});for(const p of COMMON){const u=new URL(p,base).toString();m.set(u,Math.max(m.get(u)||0,15));}return[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,18).map(([u])=>u);}
function extract(html:string,sourceUrl:string,needed:Set<string>):Hit[]{const $=cheerio.load(html);const out:Hit[]=[];const nodes=$("article,li,tr,.staff,.staff-member,.staff-card,.person,.employee,.contact,.directory-item,.card,.profile,section,div").toArray();for(const el of nodes){const node=$(el);const text=clean(node.text());if(text.length<8||text.length>850)continue;for(const role of needed){const rx=ROLE_RX[role];if(!rx||!rx.test(text))continue;const email=(node.find('a[href^="mailto:"]').first().attr('href')||'').replace(/^mailto:/i,'').split('?')[0]||text.match(EMAIL_RE)?.[0]||null;const phone=(node.find('a[href^="tel:"]').first().attr('href')||'').replace(/^tel:/i,'')||text.match(PHONE_RE)?.[0]||null;const titleLine=node.text().split(/\r?\n|\||•/).map(clean).filter(Boolean).find(x=>rx.test(x)&&x.length<=160)||clean(text.match(rx)?.[0]||'');const nameSources=[node.find('.name,.staff-name,.employee-name,.person-name,h1,h2,h3,h4,strong,b').first().text(),node.find('a').filter((_,a)=>!/^mailto:|^tel:/i.test($(a).attr('href')||'')).first().text()];let fullName:string|null=null;for(const raw of nameSources){fullName=plausibleName(raw);if(fullName)break;}if(!fullName&&email)fullName=plausibleName(email.split('@')[0].replace(/[._-]+/g,' '));if(!fullName||!titleLine)continue;out.push({role,fullName,title:titleLine,email,phone,sourceUrl,score:(email?4:0)+(phone?2:0)+(titleLine.length<120?2:0)});}}
  const lines=$('body').text().split(/\r?\n/).map(clean).filter(x=>x.length>1&&x.length<220);
  for(let i=0;i<lines.length;i++){for(const role of needed){const rx=ROLE_RX[role];if(!rx||!rx.test(lines[i]))continue;const context=lines.slice(Math.max(0,i-4),Math.min(lines.length,i+5));const email=context.join(' ').match(EMAIL_RE)?.[0]||null;const phone=context.join(' ').match(PHONE_RE)?.[0]||null;let fullName:string|null=null;for(const offset of[-1,1,-2,2,-3,3]){const line=lines[i+offset];if(!line)continue;fullName=plausibleName(line);if(fullName)break;}if(!fullName&&email)fullName=plausibleName(email.split('@')[0].replace(/[._-]+/g,' '));if(!fullName)continue;out.push({role,fullName,title:lines[i],email,phone,sourceUrl,score:(email?4:0)+(phone?2:0)+1});}}
  const best=new Map<string,Hit>();for(const h of out){const old=best.get(h.role);if(!old||h.score>old.score)best.set(h.role,h);}return[...best.values()];}
async function counts(sql:ReturnType<typeof getSql>){return (await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code=$1`,[STATE]) as any[])[0];}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req);if(auth)return auth;
  const sql=getSql();const started=Date.now();const before=await counts(sql);
  const siteResolution=await resolveK12OfficialSites(160,STATE);
  const agencies=await sql.query(`
    select a.id::text,a.canonical_name,a.website,array_agg(distinct c.role_key) filter(where c.verification_status='missing') roles
    from agencies a join raven_state_contacts c on c.agency_id=a.id
    where c.state_code=$1 and c.scope='district' and c.verification_status='missing'
      and c.role_key in ('assistant_superintendent','it_director','school_board','security_director')
      and a.website is not null and btrim(a.website)<>''
      and a.website !~* '^https?://nces\\.ed\\.gov/'
      and not exists (
        select 1 from raven_enrichment_runs r
        where r.agency_id=a.id and r.status in ('running','completed')
          and r.diagnostics->>'sourceClass'=$2
          and r.diagnostics->>'website'=a.website
      )
    group by a.id,a.canonical_name,a.website
    order by coalesce((select max(r.started_at) from raven_enrichment_runs r where r.agency_id=a.id),'1970-01-01'::timestamptz),a.canonical_name
    limit $3
  `,[STATE,SOURCE_CLASS,AGENCY_LIMIT]) as Agency[];

  let attempted=0,pages=0,promoted=0,blocked=0;const touched=new Set<string>();
  async function crawl(a:Agency){if(Date.now()-started>RUN_BUDGET)return;attempted++;touched.add(a.id);const run=(await sql.query(`insert into raven_enrichment_runs(agency_id,status,diagnostics) values($1,'running',$2::jsonb) returning id::text`,[a.id,JSON.stringify({sourceClass:SOURCE_CLASS,website:a.website,state:STATE})]) as any[])[0];const runId=run?.id;let agencyPages=0;const seed=safeUrl(a.website);if(!seed){blocked++;if(runId)await sql.query(`update raven_enrichment_runs set status='completed',completed_at=now(),diagnostics=coalesce(diagnostics,'{}'::jsonb)||$2::jsonb where id=$1`,[runId,JSON.stringify({result:'blocked_invalid_url'})]);return;}const home=await fetchHtml(seed.toString());if(!home){blocked++;if(runId)await sql.query(`update raven_enrichment_runs set status='completed',completed_at=now(),pages_scanned=0,people_found=0,diagnostics=coalesce(diagnostics,'{}'::jsonb)||$2::jsonb where id=$1`,[runId,JSON.stringify({result:'blocked_no_html'})]);return;}const base=safeUrl(home.url)||seed;const needed=new Set<string>((a.roles||[]).map(String));const hits:Hit[]=[];hits.push(...extract(home.html,base.toString(),needed));pages++;agencyPages++;for(const u of links(base,home.html)){if(Date.now()-started>RUN_BUDGET||hits.length>=needed.size*3)break;const page=await fetchHtml(u);if(!page)continue;const final=safeUrl(page.url);if(!final||!sameSite(base,final))continue;pages++;agencyPages++;hits.push(...extract(page.html,final.toString(),needed));}const best=new Map<string,Hit>();for(const h of hits){const old=best.get(h.role);if(!old||h.score>old.score)best.set(h.role,h);}for(const h of best.values()){const rows=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,verification_status='candidate',evidence_note='Candidate discovered on current official Florida district website; no email inferred.',updated_at=now() where agency_id=$1 and role_key=$7 and verification_status='missing' returning id`,[a.id,h.fullName,h.title,h.email,h.phone,h.sourceUrl,h.role]) as any[];promoted+=rows.length;}if(runId)await sql.query(`update raven_enrichment_runs set status='completed',completed_at=now(),pages_scanned=$2,people_found=$3,diagnostics=coalesce(diagnostics,'{}'::jsonb)||$4::jsonb where id=$1`,[runId,agencyPages,best.size,JSON.stringify({result:best.size?'candidates_found':'exhausted',roles:[...needed]})]);}

  for(let i=0;i<agencies.length&&Date.now()-started<RUN_BUDGET;i+=CONCURRENCY)await Promise.all(agencies.slice(i,i+CONCURRENCY).map(crawl));
  const after=await counts(sql);
  const remainingUntouched=(await sql.query(`select count(distinct c.agency_id)::int n from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code=$1 and c.scope='district' and c.verification_status='missing' and c.role_key in ('assistant_superintendent','it_director','school_board','security_director') and a.website is not null and btrim(a.website)<>'' and a.website !~* '^https?://nces\\.ed\\.gov/' and not exists(select 1 from raven_enrichment_runs r where r.agency_id=a.id and r.status in ('running','completed') and r.diagnostics->>'sourceClass'=$2 and r.diagnostics->>'website'=a.website)`,[STATE,SOURCE_CLASS]) as any[])[0]?.n||0;
  return NextResponse.json({ok:true,state:STATE,mode:'durable-statewide-official-district-queue',sourceClass:SOURCE_CLASS,siteResolution,districtsSelected:agencies.length,districtsNewlyAttempted:touched.size,pagesScanned:pages,candidatesPromoted:promoted,blocked,remainingUntouched,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected},elapsedMs:Date.now()-started});
}
