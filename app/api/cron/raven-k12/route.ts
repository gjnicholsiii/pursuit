import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { requireInternalAuth } from "@/lib/internal-auth";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FETCH_TIMEOUT=7000;
const RUN_BUDGET=250000;
const AGENCY_LIMIT=96;
const CONCURRENCY=8;
const EMAIL_RE=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
const PHONE_RE=/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
const BANNED=/\b(facilit(?:y|ies)|plant|maintenance|buildings?\s*(?:&|and)\s*grounds|procurement|purchasing|finance|financial|principal|teacher|operations?|transportation|food service|human resources|\bhr\b)\b/i;
const ROLE_RX:Record<string,RegExp>={
  superintendent:/\b(?!(?:assistant|deputy|associate)\s+)(?:district\s+)?superintendent\b/i,
  assistant_superintendent:/\b(?:assistant|asst\.?)\s+superintendent\b/i,
  security_director:/\b(?:director|chief|executive director|senior director|associate superintendent|program coordinator)\b.{0,80}\b(?:security|school safety|public safety|safety and security|security and safety|emergency management|safe schools)\b|\b(?:security|school safety|public safety|safety and security|security and safety|emergency management|safe schools)\b.{0,80}\b(?:director|chief|executive director|senior director|associate superintendent|program coordinator)\b/i,
  it_director:/\b(?:director|executive director|chief information officer|chief technology officer|cio|cto)\b.{0,70}\b(?:information technology|technology|information systems|it services|network services|tech infrastructure|cybersecurity)\b|\b(?:information technology|technology|information systems|it services|network services|tech infrastructure|cybersecurity)\b.{0,70}\b(?:director|executive director|chief information officer|chief technology officer|cio|cto)\b/i,
  school_board:/\b(?:school\s+|governing\s+)?board\s+(?:member|chair|chairman|chairwoman|president|vice president|trustee|clerk)\b|\bboard trustee\b/i,
};
const LINK_RX=/staff|directory|administration|leadership|superintendent|technology|information.?technology|security|safety|emergency|board|governance|district.?office|cabinet|executive/i;
const COMMON=["/staff","/staff-directory","/directory","/administration","/leadership","/superintendent","/technology","/departments/technology","/information-technology","/security","/safety","/school-safety","/board","/school-board"];

function clean(v:string){return v.replace(/\s+/g," ").trim();}
function safeUrl(raw:string){try{const u=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);if(!/^https?:$/.test(u.protocol))return null;return u;}catch{return null;}}
function host(u:URL){return u.hostname.toLowerCase().replace(/^www\./,"");}
function sameSite(a:URL,b:URL){const x=host(a),y=host(b);return x===y||x.endsWith(`.${y}`)||y.endsWith(`.${x}`);}
function plausibleName(v:string){const s=clean(v.replace(EMAIL_RE," ").replace(PHONE_RE," ").replace(/[^A-Za-z.' -]/g," "));if(s.length<5||s.length>70)return null;const parts=s.split(" ").filter(Boolean);if(parts.length<2||parts.length>5)return null;if(/director|superintendent|technology|security|safety|board|school|district|department|office|contact|email|phone|services|president|chair|trustee/i.test(s))return null;return parts.every(p=>/^[A-Za-z][A-Za-z.'-]*$/.test(p))?s:null;}
async function fetchHtml(url:string){const c=new AbortController();const t=setTimeout(()=>c.abort(),FETCH_TIMEOUT);try{const r=await fetch(url,{redirect:"follow",cache:"no-store",signal:c.signal,headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/4.0; public-directory-research)",accept:"text/html,application/xhtml+xml"}});if(!r.ok)return null;const type=(r.headers.get("content-type")||"").toLowerCase();if(!type.includes("html"))return null;return{html:await r.text(),url:r.url||url};}catch{return null;}finally{clearTimeout(t);}}
function links(base:URL,html:string){const $=cheerio.load(html);const scored=new Map<string,number>();$("a[href]").each((_,el)=>{const href=$(el).attr("href")||"";const label=clean($(el).text());try{const u=new URL(href,base);u.hash="";if(!sameSite(base,u)||!/^https?:$/.test(u.protocol))return;const text=`${label} ${u.pathname}`;if(!LINK_RX.test(text))return;let score=10;if(/staff|directory|leadership|administration|cabinet/i.test(text))score+=10;if(/superintendent|technology|security|safety|board/i.test(text))score+=20;scored.set(u.toString(),Math.max(scored.get(u.toString())||0,score));}catch{}});for(const p of COMMON){const u=new URL(p,base).toString();scored.set(u,Math.max(scored.get(u)||0,15));}return[...scored.entries()].sort((a,b)=>b[1]-a[1]).slice(0,16).map(([u])=>u);}
function extract(html:string,sourceUrl:string,needed:Set<string>){const $=cheerio.load(html);const out:any[]=[];const nodes=$("article,li,tr,.staff,.staff-member,.staff-card,.person,.employee,.contact,.directory-item,.card,.profile,section,div").toArray();for(const el of nodes){const node=$(el);const text=clean(node.text());if(text.length<8||text.length>850)continue;for(const role of needed){const rx=ROLE_RX[role];if(!rx||!rx.test(text))continue;const match=text.match(rx)?.[0]||"";if(!match||BANNED.test(match))continue;const email=(node.find('a[href^="mailto:"]').first().attr("href")||"").replace(/^mailto:/i,"").split("?")[0]||text.match(EMAIL_RE)?.[0]||null;const phone=(node.find('a[href^="tel:"]').first().attr("href")||"").replace(/^tel:/i,"")||text.match(PHONE_RE)?.[0]||null;const candidates=[node.find(".name,.staff-name,.employee-name,.person-name,h1,h2,h3,h4,strong,b").first().text(),node.find("a").filter((_,a)=>!/^mailto:|^tel:/i.test($(a).attr("href")||"")).first().text()];let fullName:null|string=null;for(const c of candidates){fullName=plausibleName(c);if(fullName)break;}if(!fullName&&email)fullName=plausibleName(email.split("@")[0].replace(/[._-]+/g," "));if(!fullName)continue;let title=clean(match);const rawLines=node.text().split(/\r?\n|\||•/).map(clean).filter(Boolean);const exactLine=rawLines.find(line=>rx.test(line)&&line.length<=140&&!BANNED.test(line));if(exactLine)title=exactLine;out.push({role,fullName,title,email,phone,sourceUrl,score:(email?4:0)+(phone?2:0)+(exactLine?2:0)});}}const best=new Map<string,any>();for(const c of out){const old=best.get(c.role);if(!old||c.score>old.score)best.set(c.role,c);}return[...best.values()];}

export async function GET(req:NextRequest){const auth=requireInternalAuth(req);if(auth)return auth;const started=Date.now();const sql=getSql();try{const agencies=await sql.query(`
      select a.id::text,a.canonical_name,a.website,a.state_code,a.county,
             array_agg(distinct c.role_key) filter(where c.verification_status='missing') roles,
             min(c.updated_at) as oldest_missing_update
      from agencies a
      join raven_state_contacts c on c.agency_id=a.id and c.scope='district' and c.verification_status='missing'
      where a.agency_type='k12' and a.website is not null and btrim(a.website)<>''
      group by a.id,a.canonical_name,a.website,a.state_code,a.county
      order by min(c.updated_at) asc nulls first,a.state_code,a.county,a.canonical_name
      limit $1
    `,[AGENCY_LIMIT]) as any[];
    let attempted=0,pages=0,found=0,promoted=0,failed=0;
    async function noteAttempt(a:any,note:string){await sql.query(`update raven_state_contacts set updated_at=now(),evidence_note=$2 where agency_id=$1 and scope='district' and verification_status='missing'`,[a.id,note]);}
    async function crawl(a:any){if(Date.now()-started>RUN_BUDGET)return;attempted++;await noteAttempt(a,'Raven crawl attempted; awaiting authoritative contact discovery.');const seed=safeUrl(String(a.website||""));if(!seed){failed++;await noteAttempt(a,'Raven crawl blocked: invalid district website URL.');return;}const home=await fetchHtml(seed.toString());if(!home){failed++;await noteAttempt(a,'Raven crawl blocked: district website did not return usable server-rendered HTML. Route to source-family or authoritative-roster ingestion.');return;}const base=safeUrl(home.url)||seed;const needed=new Set<string>((a.roles||[]).map(String));const all:any[]=[];all.push(...extract(home.html,base.toString(),needed));pages++;const queue=links(base,home.html);for(const u of queue){if(Date.now()-started>RUN_BUDGET||all.length>=needed.size*3)break;const page=await fetchHtml(u);if(!page)continue;const final=safeUrl(page.url);if(!final||!sameSite(base,final))continue;pages++;all.push(...extract(page.html,final.toString(),needed));}const best=new Map<string,any>();for(const c of all){const old=best.get(c.role);if(!old||c.score>old.score)best.set(c.role,c);}for(const c of best.values()){const rows=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,verification_status='candidate',evidence_note='Candidate discovered directly from official district website by targeted missing-slot crawler.',updated_at=now() where agency_id=$1 and role_key=$7 and verification_status='missing' returning id`,[a.id,c.fullName,c.title,c.email,c.phone,c.sourceUrl,c.role]);if(rows.length){promoted+=rows.length;found++;}}if(!best.size)await noteAttempt(a,'Raven crawl completed with zero eligible contacts; moved to back of queue for alternate-source ingestion.');}
    for(let i=0;i<agencies.length&&Date.now()-started<RUN_BUDGET;i+=CONCURRENCY)await Promise.all(agencies.slice(i,i+CONCURRENCY).map(crawl));return NextResponse.json({ok:true,mode:'durable-missing-slot-queue',agenciesSelected:agencies.length,attempted,pagesScanned:pages,contactsFound:found,candidatesPromoted:promoted,failed,elapsedMs:Date.now()-started});}catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}}
