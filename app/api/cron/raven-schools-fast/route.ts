import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};
const BATCH = 80;
const CONCURRENCY = 12;
const ROLE_KEYS = ["superintendent","it_director","school_board","security_director"] as const;
type RoleKey = typeof ROLE_KEYS[number];

type Counts = { total:number; verified:number; candidate:number; missing:number; rejected:number };
type Slot = { id:string; agency_id:string; state_code:string; role_key:RoleKey; canonical_name:string; website:string|null; nces_id:string|null };
type Contact = { role:RoleKey; fullName:string; title:string; email:string|null; phone:string|null; sourceUrl:string };
type SiteResult = { agencyId:string; state:string; district:string; slots:Slot[]; officialUrl:string|null; pagesScanned:number; contacts:Contact[]; error?:string };

function txt(v:unknown){return String(v??"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();}
function host(url:string){try{return new URL(url).hostname.toLowerCase().replace(/^www\./,"");}catch{return"";}}
function isBadHost(h:string){return !h || /(^|\.)(nces\.ed\.gov|facebook\.com|instagram\.com|x\.com|twitter\.com|linkedin\.com|youtube\.com)$/.test(h) || /(ionwave|opengov|bonfirehub|jaggaer|bidnet|publicpurchase|bidsync|periscope|vendorregistry|planetbids)/i.test(h);}
function plausibleName(raw:string){
  const s=txt(raw).replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i,"").replace(/\s+(ph\.?d\.?|ed\.?d\.?)$/i,"").trim();
  if(s.length<5||s.length>80||/@|\d/.test(s))return null;
  if(/superintendent|technology|information|security|safety|board|district|school|office|department|director|chief|president|chair/i.test(s))return null;
  const p=s.split(/\s+/);if(p.length<2||p.length>6)return null;
  if(!p.every(x=>/^[A-Za-z][A-Za-z.'-]*$/.test(x)))return null;
  return s;
}
function normalizePhone(v:string){const m=v.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?:\s*(?:x|ext\.?)[\s.:]*\d{1,6})?/i);return m?txt(m[0]):null;}
function normalizeEmail(v:string){const m=v.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);return m?m[0].toLowerCase():null;}
function titleRole(title:string):RoleKey|null{
  const t=title.toLowerCase();
  if(/assistant|associate|deputy/.test(t)&&/superintendent/.test(t))return null;
  if(/\b(interim\s+)?superintendent\b/.test(t))return "superintendent";
  if(/\b(cio|cto)\b|chief\s+(information|technology)|director\s+of\s+(technology|information|it)|technology\s+director|information\s+technology\s+director|director,?\s+(technology|information)/.test(t))return "it_director";
  if(/school\s+board\s+(president|chair)|board\s+(president|chair)|president,?\s+(board|school board)|chair(person)?,?\s+(board|school board)/.test(t))return "school_board";
  if(/(director|chief|coordinator|executive director)\s+of\s+(school\s+)?(safety|security|safety\s*&\s*security|security\s*&\s*safety|emergency management)|school\s+police\s+chief|chief\s+of\s+(school\s+)?police|safety\s+director|security\s+director/.test(t))return "security_director";
  return null;
}
function titlePriority(role:RoleKey,title:string){const t=title.toLowerCase();if(role==="school_board"){if(/president|chairperson|chair\b/.test(t))return 0;if(/vice/.test(t))return 1;if(/secretary/.test(t))return 2;return 3;}return 0;}

async function fetchHtml(url:string,timeout=9000){const c=new AbortController();const timer=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{headers:HEADERS,cache:"no-store",redirect:"follow",signal:c.signal});const type=r.headers.get("content-type")||"";if(!r.ok||(!type.includes("html")&&!type.includes("text")))return{ok:false,status:r.status,url:r.url||url,html:""};return{ok:true,status:r.status,url:r.url||url,html:await r.text()};}catch{return{ok:false,status:0,url,html:""};}finally{clearTimeout(timer);}}

async function officialSite(slot:Slot){
  const w=slot.website?.trim();
  if(w&&!isBadHost(host(w)))return w;
  const nces=slot.nces_id||w?.match(/[?&](?:ID2|DistrictID)=(\d+)/i)?.[1];
  if(!nces)return null;
  const detail=`https://nces.ed.gov/ccd/districtsearch/district_detail.asp?ID2=${encodeURIComponent(nces)}`;
  const r=await fetchHtml(detail,10000);if(!r.ok)return null;
  const $=cheerio.load(r.html);let found:string|null=null;
  $("a[href]").each((_,el)=>{if(found)return;const label=txt($(el).text());const href=$(el).attr("href")||"";if(!/website|web site|district home|homepage/i.test(label)&&!/^https?:\/\//i.test(href))return;try{const u=new URL(href,r.url);const h=host(u.toString());if(!isBadHost(h)&&h!=="nces.ed.gov")found=u.toString();}catch{}});
  return found;
}

function contactBlocks(html:string,sourceUrl:string){
  const $=cheerio.load(html);const out:Contact[]=[];
  const selectors="article,li,tr,.staff,.staff-member,.staff-card,.person,.employee,.directory-item,.profile,.card,.board-member,.contact,.team-member,section";
  $(selectors).each((_,el)=>{
    const n=$(el);const block=txt(n.text());if(block.length<8||block.length>1400)return;
    const role=titleRole(block);if(!role)return;
    let title="";
    const titleCandidates=[n.find(".title,.job-title,.position,.role,.staff-title,.person-title").first().text(),...block.split(/\s{2,}|\n/).slice(0,8)];
    for(const x of titleCandidates){if(titleRole(txt(x))===role){title=txt(x);break;}}
    if(!title){const m=block.match(/(?:Interim\s+)?Superintendent|Chief\s+(?:Information|Technology)\s+Officer|Director\s+of\s+(?:Information Technology|Technology|Safety|Security|Safety\s*&\s*Security|Security\s*&\s*Safety|Emergency Management)|School\s+Board\s+(?:President|Chair)|Board\s+(?:President|Chair)|School\s+Police\s+Chief|Chief\s+of\s+Police/i);title=m?txt(m[0]):"";}
    if(!title)return;
    const nameCandidates=[n.find(".name,.staff-name,.person-name,.employee-name,.board-member-name,h1,h2,h3,h4,strong,b").first().text(),...block.split(/\s{2,}|\n|\|/).slice(0,10)];
    let fullName:string|null=null;for(const x of nameCandidates){const p=plausibleName(x);if(p){fullName=p;break;}}
    if(!fullName)return;
    const hrefs=n.find("a[href]").toArray().map(a=>$(a).attr("href")||"");
    const email=hrefs.map(x=>x.match(/^mailto:([^?]+)/i)?.[1]||"").map(normalizeEmail).find(Boolean)||normalizeEmail(block);
    const phone=hrefs.map(x=>x.match(/^tel:(.+)/i)?.[1]||"").map(normalizePhone).find(Boolean)||normalizePhone(block);
    if(!email&&!phone)return;
    out.push({role,fullName,title,email:email||null,phone:phone||null,sourceUrl});
  });
  return out;
}

function relevantLinks(html:string,base:string){
  const $=cheerio.load(html);const baseHost=host(base);const scored:{url:string;score:number}[]=[];
  $("a[href]").each((_,el)=>{const label=txt($(el).text());const href=$(el).attr("href")||"";const hay=`${label} ${href}`.toLowerCase();let score=0;
    if(/superintendent|district leadership|administration|leadership/.test(hay))score+=5;
    if(/technology|information technology|\bit\b|technology services/.test(hay))score+=5;
    if(/board of education|school board|board members|boardmember/.test(hay))score+=5;
    if(/safety|security|school police|emergency management/.test(hay))score+=5;
    if(/staff directory|directory|departments|district office|contact/.test(hay))score+=3;
    if(score===0)return;try{const u=new URL(href,base);if(!/^https?:$/.test(u.protocol)||host(u.toString())!==baseHost)return;u.hash="";scored.push({url:u.toString(),score});}catch{}});
  return [...new Map(scored.sort((a,b)=>b.score-a.score).map(x=>[x.url,x])).values()].slice(0,10).map(x=>x.url);
}

async function inspectAgency(slots:Slot[]):Promise<SiteResult>{
  const first=slots[0];const result:SiteResult={agencyId:first.agency_id,state:first.state_code,district:first.canonical_name,slots,officialUrl:null,pagesScanned:0,contacts:[]};
  try{
    const url=await officialSite(first);result.officialUrl=url;if(!url)return result;
    const home=await fetchHtml(url,9000);if(!home.ok){result.error=`home HTTP ${home.status}`;return result;}result.pagesScanned++;
    const pages=[{url:home.url,html:home.html}];const links=relevantLinks(home.html,home.url);
    for(let i=0;i<links.length;i+=5){const got=await Promise.all(links.slice(i,i+5).map(u=>fetchHtml(u,8000)));for(const r of got){if(r.ok){pages.push({url:r.url,html:r.html});result.pagesScanned++;}}}
    const wanted=new Set(slots.map(s=>s.role_key));const all=pages.flatMap(p=>contactBlocks(p.html,p.url)).filter(c=>wanted.has(c.role));
    const best=new Map<RoleKey,Contact>();for(const c of all){const prior=best.get(c.role);if(!prior||titlePriority(c.role,c.title)<titlePriority(prior.role,prior.title))best.set(c.role,c);}
    result.contacts=[...best.values()];return result;
  }catch(e){result.error=e instanceof Error?e.message:String(e);return result;}
}

async function counts(sql:ReturnType<typeof getSql>):Promise<Counts>{const r=await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as Counts[];return r[0];}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req);if(auth)return auth;const sql=getSql();const before=await counts(sql);
  const rows=await sql.query(`
    select c.id::text,c.agency_id::text,c.state_code,c.role_key,a.canonical_name,a.website,a.nces_id
    from raven_state_contacts c join agencies a on a.id=c.agency_id
    where c.scope='district' and c.verification_status='missing' and c.role_key=any($1::text[])
      and not exists (
        select 1 from raven_enrichment_runs r where r.agency_id=c.agency_id and r.status='completed'
          and r.diagnostics->>'worker'='raven-official-district-site-v1'
          and coalesce(r.diagnostics->>'roles','') like '%'||c.role_key||'%'
      )
    order by c.state_code,a.canonical_name,c.role_key
    limit $2
  `,[ROLE_KEYS,BATCH*4]) as Slot[];
  const byAgency=new Map<string,Slot[]>();for(const s of rows){const a=byAgency.get(s.agency_id)||[];a.push(s);byAgency.set(s.agency_id,a);if(byAgency.size>=BATCH)break;}
  const work=[...byAgency.values()];let results:SiteResult[]=[];
  for(let i=0;i<work.length;i+=CONCURRENCY){results.push(...await Promise.all(work.slice(i,i+CONCURRENCY).map(inspectAgency)));}

  const writes:any[]=[];let filled=0;let verified=0;
  for(const r of results){
    const roles=r.slots.map(s=>s.role_key).join(',');
    await sql.query(`insert into raven_enrichment_runs(agency_id,status,completed_at,pages_scanned,pages_fetched,people_found,diagnostics) values($1,'completed',now(),$2,$2,$3,$4::jsonb)`,[r.agencyId,r.pagesScanned,r.contacts.length,JSON.stringify({worker:'raven-official-district-site-v1',roles,officialUrl:r.officialUrl,error:r.error||null})]);
    for(const c of r.contacts){const slot=r.slots.find(s=>s.role_key===c.role);if(!slot)continue;
      const changed=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,verification_status='verified',verified_at=now(),evidence_note=$7,updated_at=now() where id=$1 and verification_status='missing' returning id`,[slot.id,c.fullName,c.title,c.email,c.phone,c.sourceUrl,'Published current leadership contact on the official district website. Person, title, and published phone/email were taken directly from the cited district page; no email pattern inferred.']) as any[];
      if(changed.length){filled++;verified++;writes.push({state:slot.state_code,district:slot.canonical_name,role:slot.role_key,name:c.fullName,title:c.title,email:!!c.email,phone:!!c.phone,source:c.sourceUrl});}
    }
  }
  const after=await counts(sql);const stateRows=await sql.query(`select state_code,role_key,count(*) filter(where verification_status='missing')::int missing from raven_state_contacts where role_key=any($1::text[]) group by state_code,role_key order by state_code,role_key`,[ROLE_KEYS]) as any[];
  const summary={ok:true,mode:'official-district-website-fallback-v1',districtsProcessedInBulk:work.length,pagesScanned:results.reduce((n,r)=>n+r.pagesScanned,0),contactsFound:results.reduce((n,r)=>n+r.contacts.length,0),filled,verified,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected},writes:writes.slice(0,100),missingByStateRole:stateRows};
  console.log('RAVEN_OFFICIAL_DISTRICT_SITE',summary);return NextResponse.json(summary);
}
