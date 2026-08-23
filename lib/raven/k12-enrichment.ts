import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";

type Agency = { id: string; canonical_name: string; website: string };
type Candidate = { name: string; title: string; roleFamily: string; email?: string; phone?: string; sourceUrl: string; confidence: number };
type Page = { html: string; finalUrl: string; contentType: string };

const ROLE_RULES: Array<{ family: string; terms: RegExp }> = [
  { family: "Technology", terms: /\b(cio|cto|chief technology|chief information|director of technology|technology director|director of information technology|it director|information technology director|network director|director of infrastructure|technology coordinator|technology administrator)\b/i },
  { family: "Security", terms: /\b(director of (?:safety|security)|safety director|security director|school safety|chief of security|public safety|emergency management|safe schools|safety coordinator)\b/i },
  { family: "Facilities", terms: /\b(facilities director|director of facilities|operations director|director of operations|chief operations officer|coo|maintenance director|director of maintenance|facilities manager)\b/i },
  { family: "Executive", terms: /\b(superintendent|deputy superintendent|assistant superintendent)\b/i },
  { family: "Procurement", terms: /\b(procurement|purchasing|director of finance|chief financial officer|cfo|business manager|purchasing director|procurement director)\b/i },
  { family: "Board", terms: /\b(board president|board vice president|board member|school board|board chair)\b/i },
];

const TARGET_LINK_RE = /staff|directory|administration|leadership|technology|information.?technology|\bit\b|security|safety|facilities|operations|procurement|purchasing|board|departments|district office|superintendent|business services/i;
const PROCUREMENT_PORTAL_RE=/(ionwave|opengov|oregonbuys|bidnet|publicpurchase|bonfirehub|jaggaer|bidsync|periscope|scbo\.sc\.gov|app\.az\.gov|eva\.virginia\.gov|mvendor\.cgieva\.com|evp\.nc\.gov|vendorregistry|planetbids)/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
const COMMON_PATHS = [
  "/staff", "/staff-directory", "/directory", "/contact-us", "/administration", "/leadership", "/departments", "/district-office",
  "/technology", "/departments/technology", "/information-technology", "/departments/information-technology", "/it", "/departments/it",
  "/facilities", "/departments/facilities", "/operations", "/departments/operations", "/maintenance",
  "/safety", "/security", "/school-safety", "/departments/safety", "/departments/security",
  "/procurement", "/purchasing", "/business-services", "/finance", "/board", "/school-board", "/superintendent"
];

function safePublicUrl(raw: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return null;
    return url;
  } catch { return null; }
}

function decode(text: string) { return text.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;/g, "'").replace(/&quot;/gi, '"').replace(/&lt;/gi, "<").replace(/&gt;/gi, ">"); }
function cleanText(value: string) { return decode(value).replace(/\s+/g, " ").trim(); }
function canonicalHost(host: string) { return host.toLowerCase().replace(/^www\./, ""); }
function sameSite(a: URL, b: URL) { return canonicalHost(a.hostname) === canonicalHost(b.hostname); }
function titleCaseName(value: string) { return value.trim().replace(/\s+/g, " ").replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase()); }
function plausibleName(value: string) {
  const s = value.replace(EMAIL_RE, " ").replace(PHONE_RE, " ").replace(/[^A-Za-z.' -]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length < 5 || s.length > 60) return null;
  const parts = s.split(" ").filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return null;
  if (/director|superintendent|technology|security|facilities|board|department|school|district|office|contact|email|phone|staff|administration|services/i.test(s)) return null;
  if (!parts.every(p => /^[A-Za-z][A-Za-z.'-]*$/.test(p))) return null;
  return titleCaseName(s);
}
function roleFor(text: string) { return ROLE_RULES.find(r => r.terms.test(text)); }

async function fetchPage(url: string, allowXml = false): Promise<Page | null> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url,{redirect:"follow",signal:controller.signal,cache:"no-store",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/2.0; +public-business-intelligence)","accept":allowXml?"text/html,application/xhtml+xml,application/xml,text/xml":"text/html,application/xhtml+xml"}});
    if (!res.ok) return null;
    const contentType=(res.headers.get("content-type")||"").toLowerCase();
    if(!contentType.includes("html")&&!(allowXml&&(contentType.includes("xml")||contentType.includes("text/plain"))))return null;
    return {html:await res.text(),finalUrl:res.url||url,contentType};
  } catch { return null; } finally { clearTimeout(timer); }
}

function ncesSeedCandidates(seed: URL) {
  if (!seed.hostname.endsWith("nces.ed.gov")) return [seed.toString()];
  const id=seed.searchParams.get("ID2")||seed.searchParams.get("DistrictID"); if(!id)return[seed.toString()];
  return [`https://nces.ed.gov/ccd/districtsearch/district_detail.asp?ID2=${encodeURIComponent(id)}`,`https://nces.ed.gov/ccd/districtsearch/district_detail.asp?DistrictID=${encodeURIComponent(id)}&ID2=${encodeURIComponent(id)}&Search=2`,seed.toString()];
}
function discoverOfficialSite(seed:URL,html:string){
  if(!seed.hostname.endsWith("nces.ed.gov"))return seed;
  const $=cheerio.load(html);const scored:Array<{url:URL;score:number}>=[];
  $("a[href]").each((_,el)=>{const href=$(el).attr("href")||"";const label=cleanText($(el).text());try{const wrapped=new URL(href,seed);let u=wrapped;if(/\/transfer\.asp$/i.test(wrapped.pathname)){const location=wrapped.searchParams.get("location");if(!location)return;const resolved=safePublicUrl(decodeURIComponent(location).replace(/^\/+/,""));if(!resolved)return;u=resolved;}if(!/^https?:$/.test(u.protocol))return;const host=canonicalHost(u.hostname);if(host.endsWith("nces.ed.gov")||host.endsWith("ed.gov")||host.endsWith("usa.gov")||/facebook|twitter|instagram|youtube|linkedin/.test(host))return;let score=0;if(/website|web site|district website|school district website/i.test(label))score+=20;if(/district|schools?|usd|isd|csd|k12/i.test(`${label} ${host}`))score+=8;if(/\.k12\.[a-z]{2}\.us$/.test(host))score+=10;if(/\.org$|\.net$|\.us$/.test(host))score+=2;scored.push({url:u,score});}catch{}});scored.sort((a,b)=>b.score-a.score);return scored[0]?.url||seed;
}
function scoreLink(label:string,href:string){const text=`${label} ${href}`;let score=0;if(TARGET_LINK_RE.test(text))score+=20;if(/technology|information.?technology|security|safety|facilities|procurement|purchasing|superintendent/i.test(text))score+=20;if(/staff|directory|administration|leadership|departments/i.test(text))score+=10;if(/board|finance|business-services|operations/i.test(text))score+=5;if(/calendar|news|athletics|menu|transportation|employment|careers|facebook|twitter|instagram|youtube/i.test(text))score-=20;return score;}
function discoverLinks(base:URL,html:string){const $=cheerio.load(html);const scored=new Map<string,number>();$("a[href]").each((_,el)=>{const href=$(el).attr("href")||"";const label=cleanText($(el).text());try{const u=new URL(href,base);if(!/^https?:$/.test(u.protocol)||!sameSite(base,u))return;u.hash="";const score=scoreLink(label,u.pathname);if(score<=0)return;const key=u.toString();scored.set(key,Math.max(scored.get(key)||0,score));}catch{}});for(const path of COMMON_PATHS){try{const u=new URL(path,base);scored.set(u.toString(),Math.max(scored.get(u.toString())||0,15));}catch{}}return[...scored.entries()].sort((a,b)=>b[1]-a[1]).map(([url])=>url);}
async function sitemapLinks(base:URL){const candidates=[new URL("/sitemap.xml",base).toString(),new URL("/sitemap_index.xml",base).toString()];const out:string[]=[];for(const candidate of candidates){const page=await fetchPage(candidate,true);if(!page)continue;const locs=[...page.html.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m=>decode(m[1].trim()));for(const raw of locs){try{const u=new URL(raw);if(!sameSite(base,u)||scoreLink("",u.pathname)<=0)continue;out.push(u.toString());}catch{}if(out.length>=40)break;}if(out.length)break;}return[...new Set(out)].slice(0,40);}

function extractCandidates(html:string,sourceUrl:string):Candidate[]{
  const $=cheerio.load(html);const found:Candidate[]=[];const containers=$("article, li, tr, .staff, .staff-member, .staff-card, .person, .employee, .contact, .directory-item, .card, .profile, div").toArray();
  for(const el of containers){const node=$(el);const text=cleanText(node.text());if(text.length<10||text.length>900)continue;const rule=roleFor(text);if(!rule)continue;const mailto=node.find('a[href^="mailto:"]').first().attr("href")?.replace(/^mailto:/i,"").split("?")[0];const email=mailto||text.match(EMAIL_RE)?.[0];const tel=node.find('a[href^="tel:"]').first().attr("href")?.replace(/^tel:/i,"");const phone=tel||text.match(PHONE_RE)?.[0];const titleCandidates=[node.find(".title,.position,.job-title,.staff-title,.role").first().text(),...ROLE_RULES.filter(r=>r.terms.test(text)).map(r=>text.match(r.terms)?.[0]||"")].map(cleanText).filter(Boolean);const title=titleCandidates[0]||text.slice(0,140);const nameSources=[node.find("h1,h2,h3,h4,strong,b,.name,.staff-name,.employee-name,.person-name").first().text(),node.find("a").filter((_,a)=>!/^mailto:|^tel:/i.test($(a).attr("href")||"")).first().text(),...text.split(/\||•|\n| {2,}| - /).slice(0,4)];let name:string|null=null;for(const source of nameSources){name=plausibleName(cleanText(source));if(name)break;}if(!name&&email)name=plausibleName(email.split("@")[0].replace(/[._-]+/g," "));if(!name)continue;found.push({name,title:cleanText(title).slice(0,140),roleFamily:rule.family,email,phone,sourceUrl,confidence:email?96:phone?90:80});}
  const bodyText=cleanText($("body").text());for(const rule of ROLE_RULES){if(!rule.terms.test(bodyText))continue;const lines=$("body").text().split(/\r?\n/).map(cleanText).filter(Boolean);for(let i=0;i<lines.length;i++){if(!rule.terms.test(lines[i]))continue;const context=lines.slice(Math.max(0,i-3),Math.min(lines.length,i+4)).join(" | ");const email=context.match(EMAIL_RE)?.[0];const phone=context.match(PHONE_RE)?.[0];let name:string|null=null;for(const offset of[-1,1,-2,2]){if(lines[i+offset]){name=plausibleName(lines[i+offset]);if(name)break;}}if(!name&&email)name=plausibleName(email.split("@")[0].replace(/[._-]+/g," "));if(name)found.push({name,title:lines[i].slice(0,140),roleFamily:rule.family,email,phone,sourceUrl,confidence:email?92:phone?86:76});}}
  const deduped=new Map<string,Candidate>();for(const c of found){const key=`${c.name}|${c.roleFamily}`.toLowerCase();const old=deduped.get(key);if(!old||c.confidence>old.confidence||(!old.email&&c.email))deduped.set(key,c);}return[...deduped.values()].slice(0,40);
}

async function enrichAgency(agency:Agency){
  const sql=getSql();const seed=safePublicUrl(agency.website);if(!seed)return{agency:agency.canonical_name,ok:false,reason:"invalid website",pages:0,people:0};if(PROCUREMENT_PORTAL_RE.test(seed.toString()))return{agency:agency.canonical_name,ok:false,reason:"procurement portal blocked",pages:0,people:0};
  const runRows=await sql.query(`insert into raven_enrichment_runs (agency_id,status) values ($1,'running') returning id::text`,[agency.id]);const runId=String(runRows[0]?.id||"");let pages=0;let people=0;const errors:string[]=[];const attemptedSeeds=ncesSeedCandidates(seed);
  try{let seedPage:Page|null=null;let workingSeed=seed;for(const candidate of attemptedSeeds){seedPage=await fetchPage(candidate);if(seedPage){workingSeed=safePublicUrl(seedPage.finalUrl)||safePublicUrl(candidate)||seed;break;}}if(!seedPage)throw new Error("seed page unavailable");pages++;let base=discoverOfficialSite(workingSeed,seedPage.html);let homepage=seedPage.html;if(PROCUREMENT_PORTAL_RE.test(base.toString()))throw new Error("procurement portal blocked");if(!sameSite(base,workingSeed)){const official=await fetchPage(base.toString());if(!official)throw new Error("official district site unavailable");pages++;base=safePublicUrl(official.finalUrl)||base;if(PROCUREMENT_PORTAL_RE.test(base.toString()))throw new Error("procurement portal blocked");homepage=official.html;await sql.query(`update agencies set website=$2 where id=$1`,[agency.id,base.toString()]);}
    const initialCandidates=extractCandidates(homepage,base.toString());const siteMap=await sitemapLinks(base);const queue=[...discoverLinks(base,homepage),...siteMap];const seen=new Set<string>([base.toString()]);const allCandidates=[...initialCandidates];while(queue.length&&pages<28&&allCandidates.length<40){const url=queue.shift()!;if(seen.has(url))continue;seen.add(url);const page=await fetchPage(url);if(!page){errors.push(url);continue;}pages++;const final=safePublicUrl(page.finalUrl)||safePublicUrl(url);if(!final||!sameSite(base,final)||PROCUREMENT_PORTAL_RE.test(final.toString()))continue;const pageCandidates=extractCandidates(page.html,final.toString());allCandidates.push(...pageCandidates);if(pageCandidates.length||TARGET_LINK_RE.test(final.pathname)){for(const link of discoverLinks(base,page.html).slice(0,12))if(!seen.has(link)&&!queue.includes(link))queue.push(link);}}
    const unique=new Map<string,Candidate>();for(const c of allCandidates){const key=`${c.name}|${c.roleFamily}`.toLowerCase();const old=unique.get(key);if(!old||c.confidence>old.confidence||(!old.email&&c.email))unique.set(key,c);}for(const c of[...unique.values()].slice(0,40)){await sql.query(`insert into raven_people (agency_id,full_name,title,role_family,email,phone,source_url,source_type,confidence,last_verified_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,'public_web',$8,now(),now()) on conflict (agency_id,full_name,title) do update set role_family=excluded.role_family,email=coalesce(excluded.email,raven_people.email),phone=coalesce(excluded.phone,raven_people.phone),source_url=excluded.source_url,confidence=greatest(raven_people.confidence,excluded.confidence),last_verified_at=now(),updated_at=now()`,[agency.id,c.name,c.title,c.roleFamily,c.email||null,c.phone||null,c.sourceUrl,c.confidence]);people++;}const status=people>0?'complete':'empty';await sql.query(`update raven_enrichment_runs set status=$2,pages_scanned=$3,people_found=$4,completed_at=now(),diagnostics=$5::jsonb where id=$1`,[runId,status,pages,people,JSON.stringify({errors:errors.slice(0,30),attemptedSeeds,officialWebsite:base.toString(),queueExhausted:queue.length===0})]);return{agency:agency.canonical_name,ok:people>0,pages,people,website:base.toString(),status};
  }catch(error){await sql.query(`update raven_enrichment_runs set status='failed',pages_scanned=$2,people_found=$3,completed_at=now(),diagnostics=$4::jsonb where id=$1`,[runId,pages,people,JSON.stringify({error:error instanceof Error?error.message:String(error),errors:errors.slice(0,30),attemptedSeeds})]);return{agency:agency.canonical_name,ok:false,pages,people,reason:error instanceof Error?error.message:String(error)};}
}

export async function enrichK12Batch(limit=6){
  const sql=getSql();const rows=await sql.query(`select a.id::text,a.canonical_name,a.website from agencies a where a.agency_type='k12' and a.website is not null and a.website<>'' and a.website !~* '(ionwave|opengov|oregonbuys|bidnet|publicpurchase|bonfirehub|jaggaer|bidsync|periscope|scbo\\.sc\\.gov|app\\.az\\.gov|eva\\.virginia\\.gov|mvendor\\.cgieva\\.com|evp\\.nc\\.gov|vendorregistry|planetbids)' and not exists(select 1 from raven_enrichment_runs r where r.agency_id=a.id and r.status='complete' and r.people_found>0 and r.completed_at>now()-interval '30 days') and not exists(select 1 from raven_enrichment_runs r where r.agency_id=a.id and r.status in('empty','failed') and r.completed_at>now()-interval '2 hours') order by case when exists(select 1 from opportunities o where o.agency_id=a.id and o.status='open' and (o.due_at is null or o.due_at>=now())) then 0 else 1 end,coalesce((select max(r.completed_at) from raven_enrichment_runs r where r.agency_id=a.id),'1970-01-01'::timestamptz),a.canonical_name limit $1`,[Math.max(1,Math.min(limit,9))]);const agencies=rows as Agency[];const results=[] as Awaited<ReturnType<typeof enrichAgency>>[];for(let i=0;i<agencies.length;i+=3){results.push(...await Promise.all(agencies.slice(i,i+3).map(enrichAgency)));}return{attempted:agencies.length,results,peopleFound:results.reduce((s,r)=>s+r.people,0),pagesScanned:results.reduce((s,r)=>s+r.pages,0)};
}
