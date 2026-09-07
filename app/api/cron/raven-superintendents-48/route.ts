import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATES=['AL','AZ','AR','CA','CO','CT','DE','FL','GA','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const LIMIT=100,CONCURRENCY=12,TIMEOUT=6500,BUDGET=260000;
const PATHS=['/superintendent','/superintendents-office','/superintendent-office','/administration','/district-office','/leadership','/staff','/staff-directory','/directory','/about/leadership'];
const TITLE_RX=/\b(superintendent of schools|district superintendent|school superintendent|superintendent)\b/i;
const EXCLUDE_TITLE_RX=/\b(assistant|associate|deputy|executive assistant|secretary to|administrative assistant|assistant to)\s+(?:the\s+)?superintendent\b/i;
const EMAIL_RE=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE=/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d+)?/i;
const BAD=/^(superintendent|office of the superintendent|superintendent's office|district office|administration|leadership|staff directory|contact us|email|phone|home)$/i;

type Agency={id:string;canonical_name:string;website:string};
type Hit={full_name:string;title:string;email:string|null;phone:string|null;source_url:string;score:number};
type Seed={district:string;full_name:string;title:string;email:string|null;phone:string|null;source_url:string;evidence:string};

const VERIFIED_SEEDS:Record<string,Seed[]>={
  AZ:[
    {district:'Lake Havasu Unified District (4368)',full_name:'Rebecca Stone',title:'Superintendent',email:null,phone:null,source_url:'https://www.lhusd.org/staff?page_no=4',evidence:'Current official Lake Havasu Unified School District staff directory lists Rebecca Stone as Superintendent.'},
    {district:'Payson Unified District (4209)',full_name:'Linda Gibson',title:'Superintendent',email:null,phone:null,source_url:'https://pusd10.org/district-leadership/',evidence:'Current official Payson Unified School District leadership page lists Linda Gibson as Superintendent.'},
    {district:'Duncan Unified District (4228)',full_name:'Eldon Merrell',title:'Superintendent',email:null,phone:'(928) 359-2472 x104',source_url:'https://aiaonline.org/schools/163',evidence:'Current Arizona Interscholastic Association member-school directory lists Eldon Merrell as Duncan Unified Superintendent.'},
    {district:'Joseph City Unified District (4388)',full_name:'Bryan Fields',title:'Superintendent',email:null,phone:'(928) 288-3361',source_url:'https://aiaonline.org/schools/114',evidence:'Current Arizona Interscholastic Association member-school directory lists Bryan Fields as Joseph City Unified Superintendent.'},
    {district:'Morenci Unified District (4230)',full_name:'Jennifer Morales',title:'Superintendent',email:null,phone:null,source_url:'https://www.azed.gov/sites/default/files/2025/04/6%20AR%20Report%20-%20Morenci%20UD.pdf',evidence:'Arizona Department of Education administrative review identifies Jennifer Morales as Superintendent of Morenci Unified District.'},
    {district:'St Johns Unified District (4153)',full_name:'Kyle Patterson',title:'Superintendent',email:'kpatterson@staff.sjusd.net',phone:'(928) 337-2255 ext. 1105',source_url:'https://www.sjusd.net/staff',evidence:'Current official St. Johns Unified School District staff directory lists Kyle Patterson as Superintendent with direct phone and email.'},
    {district:'Pima Unified District (4220)',full_name:'Stephen Estatico',title:'Superintendent',email:'sestatico@pimaschools.com',phone:'928-387-8002',source_url:'https://www.pimaschools.com/staff?page_no=2',evidence:'Current official Pima Unified School District staff directory lists Stephen Estatico as Superintendent with direct phone and email.'}
  ]
};

const clean=(v:string)=>String(v||'').replace(/\s+/g,' ').trim();
function plausibleName(v:string){
  const s=clean(v.replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i,'').replace(/[^A-Za-z.' -]/g,' '));
  if(!s||BAD.test(s)||s.length<5||s.length>60)return null;
  const p=s.split(/\s+/).filter(Boolean);
  if(p.length<2||p.length>4)return null;
  if(/superintendent|school|district|office|administration|leadership|director|assistant|department|contact|email|phone|board|meeting|upcoming|regards|welcome|message|schools|unified|public|county/i.test(s))return null;
  return p.every(x=>/^[A-Z][A-Za-z.'-]*$/.test(x))?s:null;
}
function safe(raw:string){try{const u=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);return /^https?:$/.test(u.protocol)?u:null}catch{return null}}
const host=(u:URL)=>u.hostname.toLowerCase().replace(/^www\./,'');
const sameHost=(a:URL,b:URL)=>{const x=host(a),y=host(b);return x===y||x.endsWith(`.${y}`)||y.endsWith(`.${x}`)};
async function fetchHtml(url:string){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),TIMEOUT);
  try{
    const r=await fetch(url,{cache:'no-store',redirect:'follow',signal:c.signal,headers:{'user-agent':'Mozilla/5.0 (compatible; Pursuit Raven Superintendent Completion/3.0)',accept:'text/html,application/xhtml+xml'}});
    if(!r.ok||!(r.headers.get('content-type')||'').toLowerCase().includes('html'))return null;
    return{url:r.url||url,html:await r.text()};
  }catch{return null}finally{clearTimeout(t)}
}
function links(base:URL,html:string){
  const $=cheerio.load(html),out:string[]=[];
  $('a[href]').each((_,el)=>{
    const href=$(el).attr('href')||'',label=clean($(el).text());
    if(!/(superintendent|administration|leadership|district office|staff|directory)/i.test(`${label} ${href}`))return;
    try{const u=new URL(href,base);u.hash='';if(/^https?:$/.test(u.protocol)&&sameHost(base,u))out.push(u.toString())}catch{}
  });
  for(const p of PATHS)out.push(new URL(p,base).toString());
  return[...new Set(out)].slice(0,24);
}
function extract(html:string,source:string){
  const $=cheerio.load(html),hits:Hit[]=[];
  const nodes=$('article,li,tr,.staff,.staff-member,.staff-card,.person,.employee,.contact,.directory-item,.profile,.card,section').toArray();
  for(const node of nodes){
    const n=$(node),raw=n.text(),text=clean(raw);
    if(text.length<8||text.length>700||!TITLE_RX.test(text)||EXCLUDE_TITLE_RX.test(text))continue;
    const chunks=raw.split(/\r?\n|\||•/).map(clean).filter(Boolean);
    const ti=chunks.findIndex(x=>TITLE_RX.test(x)&&!EXCLUDE_TITLE_RX.test(x)&&x.length<=180);
    if(ti<0)continue;
    const title=chunks[ti];let full:string|null=null;
    for(const c of[n.find('.name,.staff-name,.person-name,.employee-name').first().text(),...chunks.slice(Math.max(0,ti-2),ti),...chunks.slice(ti+1,ti+3)]){full=plausibleName(c);if(full)break}
    if(!full)continue;
    const mail=(n.find('a[href^="mailto:"]').first().attr('href')||'').replace(/^mailto:/i,'').split('?')[0];
    const tel=(n.find('a[href^="tel:"]').first().attr('href')||'').replace(/^tel:/i,'');
    const email=mail||text.match(EMAIL_RE)?.[0]||null,phone=tel||text.match(PHONE_RE)?.[0]||null;
    hits.push({full_name:full,title,email,phone,source_url:source,score:(email?4:0)+(phone?2:0)+2});
  }
  const lines=$('body').text().split(/\r?\n/).map(clean).filter(x=>x.length>1&&x.length<180);
  for(let i=0;i<lines.length;i++){
    if(!TITLE_RX.test(lines[i])||EXCLUDE_TITLE_RX.test(lines[i]))continue;
    let full:string|null=null;
    for(const d of[-1,1,-2,2]){const x=lines[i+d];if(x&&(full=plausibleName(x)))break}
    if(!full)continue;
    const ctx=lines.slice(Math.max(0,i-3),Math.min(lines.length,i+4)).join(' ');
    const email=ctx.match(EMAIL_RE)?.[0]||null,phone=ctx.match(PHONE_RE)?.[0]||null;
    hits.push({full_name:full,title:lines[i],email,phone,source_url:source,score:(email?4:0)+(phone?2:0)+2});
  }
  return hits.sort((a,b)=>b.score-a.score)[0]||null;
}
async function count(sql:ReturnType<typeof getSql>,state:string){
  return(await sql.query(`select count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='verified')::int verified from raven_state_contacts where state_code=$1 and scope='district' and role_key='superintendent'`,[state])as any[])[0];
}
async function applySeeds(sql:ReturnType<typeof getSql>,state:string){
  const applied:any[]=[];
  for(const s of VERIFIED_SEEDS[state]||[]){
    const rows=await sql.query(`update raven_state_contacts c set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,verification_status='verified',verified_at=now(),evidence_note=$7,updated_at=now() from agencies a where c.agency_id=a.id and a.canonical_name=$1 and c.state_code=$8 and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' returning c.id::text`,[s.district,s.full_name,s.title,s.email,s.phone,s.source_url,s.evidence,state])as any[];
    if(rows.length)applied.push({district:s.district,full_name:s.full_name,title:s.title,email:s.email,phone:s.phone,source_url:s.source_url});
  }
  return applied;
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req);if(auth)return auth;
  const sql=getSql(),started=Date.now();
  const unresolved=await sql.query(`select state_code,count(*) filter(where verification_status='missing')::int missing from raven_state_contacts where scope='district' and role_key='superintendent' and state_code=any($1::text[]) group by state_code having count(*) filter(where verification_status='missing')>0`,[STATES])as any[];
  const by=new Map(unresolved.map(r=>[r.state_code,Number(r.missing)])),state=STATES.find(s=>(by.get(s)||0)>0);
  if(!state)return NextResponse.json({ok:true,complete:true});
  const before=await count(sql,state);
  const seeded=await applySeeds(sql,state);
  let verified=seeded.length;
  const results:any[]=[...seeded];
  const agencies=await sql.query(`select a.id::text,a.canonical_name,a.website from agencies a join raven_state_contacts c on c.agency_id=a.id where c.state_code=$1 and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' and nullif(trim(a.website),'') is not null and a.website !~* '^https?://nces\\.ed\\.gov/' order by coalesce(c.updated_at,c.created_at) asc,a.canonical_name limit $2`,[state,LIMIT])as Agency[];
  async function process(a:Agency){
    if(Date.now()-started>BUDGET)return;
    const seed=safe(a.website);if(!seed)return;
    const home=await fetchHtml(seed.toString());
    if(!home){await sql.query(`update raven_state_contacts set updated_at=now() where agency_id=$1 and state_code=$2 and scope='district' and role_key='superintendent' and verification_status='missing'`,[a.id,state]);return}
    const base=safe(home.url)||seed;let best=extract(home.html,base.toString());
    for(const url of links(base,home.html)){
      if(Date.now()-started>BUDGET||best?.score>=8)break;
      const r=await fetchHtml(url);if(!r)continue;
      const u=safe(r.url);if(!u||!sameHost(base,u))continue;
      const h=extract(r.html,u.toString());if(h&&(!best||h.score>best.score))best=h;
    }
    if(!best){await sql.query(`update raven_state_contacts set updated_at=now() where agency_id=$1 and state_code=$2 and scope='district' and role_key='superintendent' and verification_status='missing'`,[a.id,state]);return}
    const rows=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,verification_status='verified',verified_at=now(),evidence_note='Verified directly from current official district website by isolated 48-state superintendent worker; no contact field inferred.',updated_at=now() where agency_id=$1 and state_code=$7 and scope='district' and role_key='superintendent' and verification_status='missing' returning id::text`,[a.id,best.full_name,best.title,best.email,best.phone,best.source_url,state])as any[];
    if(rows.length){verified+=rows.length;results.push({district:a.canonical_name,...best})}
  }
  for(let i=0;i<agencies.length&&Date.now()-started<BUDGET;i+=CONCURRENCY)await Promise.all(agencies.slice(i,i+CONCURRENCY).map(process));
  const after=await count(sql,state);
  const summary={ok:true,mode:'48-state-superintendents',state,verifiedAdded:verified,before,after,results,elapsedMs:Date.now()-started};
  console.log('RAVEN_SUPERINTENDENTS_48',summary);
  return NextResponse.json(summary);
}
