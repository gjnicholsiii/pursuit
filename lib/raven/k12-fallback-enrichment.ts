import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";

type Agency={id:string;canonical_name:string;website:string};
type Person={name:string;title:string;role:string;email:string|null;phone:string|null;sourceUrl:string;confidence:number};

const ROLE_RULES=[
  {role:'Technology',re:/\b(cio|cto|chief (?:technology|information)(?: officer)?|director of (?:technology|information technology|information systems|technology services|network services|infrastructure)|technology director|it director|technology coordinator|technology manager|network administrator|systems administrator|executive director of technology)\b/i},
  {role:'Security',re:/\b(director of (?:safety|security|safety and security|school safety)|safety director|security director|chief of security|public safety|emergency management|emergency preparedness|safety coordinator|security coordinator|executive director of (?:safety|security))\b/i},
  {role:'Facilities',re:/\b(facilities director|director of facilities|director of facilities and operations|operations director|director of operations|chief operations officer|maintenance director|director of maintenance|facilities manager|buildings? and grounds|director of buildings? and grounds|executive director of facilities|executive director of operations)\b/i},
];
const EMAIL=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
const PHONE=/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
const PATHS=['/staff','/staff-directory','/directory','/departments','/technology','/technology-services','/information-technology','/information-systems','/it','/network-services','/security','/safety','/school-safety','/safety-security','/emergency-management','/facilities','/facilities-operations','/operations','/maintenance','/buildings-grounds','/administration','/leadership'];
const JUNK=/(quick links|in this section|testing|environmental|air quality|water|road|street|avenue|boulevard|highway|department|services|office|school|district|facilities|technology|security|safety|operations|administration|maintenance|contact|calendar|resources|overview|information)/i;

function clean(v:string){return v.replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();}
function safeUrl(raw:string){try{const u=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);if(!/^https?:$/.test(u.protocol))return null;return u;}catch{return null;}}
function variants(seed:URL){
  const hosts=new Set<string>([seed.hostname,seed.hostname.startsWith('www.')?seed.hostname.slice(4):`www.${seed.hostname}`]);
  const out:string[]=[];
  for(const host of hosts){for(const protocol of ['https:','http:']){const u=new URL(seed.toString());u.protocol=protocol;u.hostname=host;out.push(u.toString());const root=new URL(`${protocol}//${host}/`);out.push(root.toString());}}
  return [...new Set(out)];
}
async function fetchHtml(url:string){
  const c=new AbortController();const timer=setTimeout(()=>c.abort(),9000);
  try{const r=await fetch(url,{redirect:'follow',cache:'no-store',signal:c.signal,headers:{'user-agent':'Mozilla/5.0 (compatible; Pursuit-Raven/2.3)','accept':'text/html,application/xhtml+xml'}});if(!r.ok)return null;const type=(r.headers.get('content-type')||'').toLowerCase();if(!type.includes('html'))return null;return{html:await r.text(),url:r.url||url};}catch{return null;}finally{clearTimeout(timer);}
}
function plausibleName(v:string){
  const s=clean(v.replace(EMAIL,' ').replace(PHONE,' ').replace(/[^A-Za-z.' -]/g,' '));
  if(s.length<5||s.length>55||JUNK.test(s)||/^[A-Z ]{8,}$/.test(s))return null;
  const parts=s.split(' ').filter(Boolean);if(parts.length<2||parts.length>5||!parts.every(p=>/^[A-Za-z][A-Za-z.'-]*$/.test(p)))return null;
  return s.replace(/(^|[\s'-])([a-z])/g,(_,a,b)=>a+b.toUpperCase());
}
function extract(html:string,sourceUrl:string){
  const $=cheerio.load(html);const found:Person[]=[];
  const blocks=$('article,li,tr,.staff,.staff-member,.staff-card,.person,.employee,.contact,.directory-item,.card,.profile,section').toArray();
  for(const el of blocks){const node=$(el);const text=clean(node.text());if(text.length<12||text.length>800)continue;const rr=ROLE_RULES.find(r=>r.re.test(text));if(!rr)continue;
    const title=clean(node.find('.title,.position,.job-title,.staff-title,.role').first().text())||clean(text.match(rr.re)?.[0]||'');if(!title)continue;
    const mail=node.find('a[href^="mailto:"]').first().attr('href')?.replace(/^mailto:/i,'').split('?')[0]||text.match(EMAIL)?.[0]||null;
    const tel=node.find('a[href^="tel:"]').first().attr('href')?.replace(/^tel:/i,'')||text.match(PHONE)?.[0]||null;
    const names=[node.find('h1,h2,h3,h4,strong,b,.name,.staff-name,.employee-name,.person-name').first().text(),node.find('a').filter((_,a)=>!/^mailto:|^tel:/i.test($(a).attr('href')||'')).first().text(),...node.text().split(/\n|\||•| - /).slice(0,6)];
    let name:string|null=null;for(const n of names){name=plausibleName(n);if(name)break;}if(!name&&mail)name=plausibleName(mail.split('@')[0].replace(/[._-]+/g,' '));if(!name)continue;
    found.push({name,title:title.slice(0,140),role:rr.role,email:mail,phone:tel,sourceUrl,confidence:mail?97:tel?92:84});
  }
  const lines=$('body').text().split(/\r?\n/).map(clean).filter(Boolean);
  for(let i=0;i<lines.length;i++){const rr=ROLE_RULES.find(r=>r.re.test(lines[i]));if(!rr)continue;const around=lines.slice(Math.max(0,i-4),Math.min(lines.length,i+5));let name:string|null=null;for(const n of around){name=plausibleName(n);if(name)break;}const joined=around.join(' | ');const mail=joined.match(EMAIL)?.[0]||null;const tel=joined.match(PHONE)?.[0]||null;if(!name&&mail)name=plausibleName(mail.split('@')[0].replace(/[._-]+/g,' '));if(name)found.push({name,title:lines[i].slice(0,140),role:rr.role,email:mail,phone:tel,sourceUrl,confidence:mail?94:tel?89:80});}
  const dedup=new Map<string,Person>();for(const p of found){const k=`${p.name}|${p.role}`.toLowerCase();const old=dedup.get(k);if(!old||p.confidence>old.confidence||(!old.email&&p.email))dedup.set(k,p);}return[...dedup.values()];
}

export async function enrichK12Fallback(limit=6){
  const sql=getSql();
  const rows=await sql.query(`select a.id::text,a.canonical_name,a.website from agencies a where a.agency_type='k12' and a.website is not null and exists(select 1 from opportunities o where o.agency_id=a.id and o.status='open' and (o.due_at is null or o.due_at>=now())) and not exists(select 1 from raven_people rp where rp.agency_id=a.id and rp.role_family in('Technology','Security','Facilities')) and not exists(select 1 from raven_enrichment_runs r where r.agency_id=a.id and r.diagnostics->>'fallback'='true' and r.completed_at>now()-interval '12 hours') order by coalesce((select max(r.completed_at) from raven_enrichment_runs r where r.agency_id=a.id),'1970-01-01'::timestamptz),a.canonical_name limit $1`,[Math.max(1,Math.min(limit,8))]) as Agency[];
  const results=[] as Array<Record<string,unknown>>;
  for(const agency of rows){
    const run=(await sql.query(`insert into raven_enrichment_runs(agency_id,status,diagnostics) values($1,'running',jsonb_build_object('fallback',true)) returning id::text`,[agency.id]))[0];
    let pages=0;const found:Person[]=[];const seed=safeUrl(agency.website);const attempted:string[]=[];
    if(seed){let home:{html:string;url:string}|null=null;for(const v of variants(seed)){attempted.push(v);home=await fetchHtml(v);if(home)break;}
      const bases:string[]=[];if(home){pages++;const u=safeUrl(home.url);if(u){bases.push(u.origin);found.push(...extract(home.html,home.url));const $=cheerio.load(home.html);$('a[href]').each((_,el)=>{const label=clean($(el).text());const href=$(el).attr('href')||'';if(!/(technology|information|network|security|safety|facilit|maintenance|operations)/i.test(`${label} ${href}`))return;try{const x=new URL(href,u);if(x.hostname.replace(/^www\./,'')===u.hostname.replace(/^www\./,''))bases.push(x.toString());}catch{}});}}
      for(const origin of [...new Set(bases)]){if(pages>=24)break;for(const p of PATHS){if(pages>=24)break;let target:string;try{target=new URL(p,origin).toString();}catch{continue;}attempted.push(target);const page=await fetchHtml(target);if(!page)continue;pages++;found.push(...extract(page.html,page.url));}}
    }
    const unique=new Map<string,Person>();for(const p of found){const k=`${p.name}|${p.role}`.toLowerCase();const old=unique.get(k);if(!old||p.confidence>old.confidence||(!old.email&&p.email))unique.set(k,p);}
    for(const p of [...unique.values()].slice(0,30))await sql.query(`insert into raven_people(agency_id,full_name,title,role_family,email,phone,source_url,source_type,confidence,last_verified_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,'public_web_fallback',$8,now(),now()) on conflict(agency_id,full_name,title) do update set role_family=excluded.role_family,email=coalesce(excluded.email,raven_people.email),phone=coalesce(excluded.phone,raven_people.phone),source_url=excluded.source_url,confidence=greatest(raven_people.confidence,excluded.confidence),last_verified_at=now(),updated_at=now()`,[agency.id,p.name,p.title,p.role,p.email,p.phone,p.sourceUrl,p.confidence]);
    const core=[...new Set([...unique.values()].map(p=>p.role))];const ok=unique.size>0;
    await sql.query(`update raven_enrichment_runs set status=$2,pages_scanned=$3,people_found=$4,completed_at=now(),diagnostics=jsonb_build_object('fallback',true,'attempted',to_jsonb($5::text[]),'coreFamiliesFound',to_jsonb($6::text[])) where id=$1`,[run.id,ok?'complete':'empty',pages,unique.size,attempted.slice(0,60),core]);
    results.push({agency:agency.canonical_name,people:unique.size,pages,core});
  }
  return{attempted:rows.length,results,peopleFound:results.reduce((n,r)=>n+Number(r.people||0),0)};
}
