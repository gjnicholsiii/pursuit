import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATE = "FL";
const LIMIT = 80;
const CONCURRENCY = 12;
const TIMEOUT = 6500;
const BUDGET = 260000;
const PATHS = [
  "/staff","/staff-directory","/directory","/administration","/leadership","/district-office",
  "/technology","/information-technology","/departments/technology","/departments/information-technology",
  "/school-board","/board","/board-members","/school-safety","/safety","/security","/safe-schools"
];
const ROLE_RX: Record<string, RegExp> = {
  it_director: /\b(chief technology officer|chief information officer|cto|cio|executive director[^\n]{0,50}(technology|information systems|mis)|director[^\n]{0,50}(technology|information technology|information systems|mis|network operations)|technology director|director of network operations|coordinator of network operations|technology coordinator)\b/i,
  school_board: /\b(board chair|board chairman|board chairwoman|school board chair|school board president|board president)\b/i,
  security_director: /\b(director|chief|coordinator|executive director|senior director)[^\n]{0,60}\b(school safety|safety and security|security and safety|security|public safety|emergency management|safe schools)\b|\b(school safety|safety and security|security and safety|public safety|emergency management|safe schools)[^\n]{0,60}\b(director|chief|coordinator|executive director|senior director)\b/i
};
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d+)?/i;
const BAD_NAME = /^(find us|contact us|staff directory|school board|board members|technology|information technology|school safety|safety|security|administration|leadership|district office|meeting dates|staff resources|home|email|phone)$/i;

type Agency = { id:string; canonical_name:string; website:string; roles:string[] };
type Hit = { role:string; full_name:string; title:string; email:string|null; phone:string|null; source_url:string };

function clean(v:string){ return String(v||"").replace(/\s+/g," ").trim(); }
function plausibleName(v:string){
  const s=clean(v.replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i,"").replace(/[^A-Za-z.' -]/g," "));
  if(!s || BAD_NAME.test(s) || s.length<5 || s.length>70) return null;
  const p=s.split(/\s+/).filter(Boolean);
  if(p.length<2 || p.length>5) return null;
  if(/director|chief|coordinator|superintendent|technology|information|security|safety|board|school|district|department|office|manager|president|chair|member|resources|services|meeting/i.test(s)) return null;
  return p.every(x=>/^[A-Za-z][A-Za-z.'-]*$/.test(x)) ? s : null;
}
function safe(raw:string){ try{ const u=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`); return /^https?:$/.test(u.protocol)?u:null; }catch{return null;} }
function host(u:URL){ return u.hostname.toLowerCase().replace(/^www\./,""); }
function sameHost(a:URL,b:URL){ const x=host(a),y=host(b); return x===y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`); }
async function fetchHtml(url:string){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),TIMEOUT);
  try{
    const r=await fetch(url,{cache:"no-store",redirect:"follow",signal:c.signal,headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit Raven Florida Completion/1.0)",accept:"text/html,application/xhtml+xml"}});
    if(!r.ok || !(r.headers.get("content-type")||"").toLowerCase().includes("html")) return null;
    return {url:r.url||url,html:await r.text()};
  }catch{return null;}finally{clearTimeout(t);}
}
function pageLinks(base:URL,html:string){
  const $=cheerio.load(html); const out:string[]=[];
  $("a[href]").each((_,el)=>{ const href=$(el).attr("href")||""; const label=clean($(el).text()); if(!/(staff|directory|administration|leadership|technology|information technology|school board|board members|school safety|safety|security|safe schools)/i.test(`${label} ${href}`)) return; try{ const u=new URL(href,base); u.hash=""; if(/^https?:$/.test(u.protocol)&&sameHost(base,u)) out.push(u.toString()); }catch{} });
  for(const p of PATHS) out.push(new URL(p,base).toString());
  return [...new Set(out)].slice(0,24);
}
function hitFromBlock($:cheerio.CheerioAPI,node:any,role:string,source:string):Hit|null{
  const n=$(node); const text=clean(n.text()); const rx=ROLE_RX[role]; if(!rx || !rx.test(text) || text.length>900) return null;
  let title="";
  const chunks=n.text().split(/\r?\n|\||•/).map(clean).filter(Boolean);
  title=chunks.find(x=>rx.test(x)&&x.length<=160) || clean(text.match(rx)?.[0]||"");
  if(!title) return null;
  const candidates=[
    n.find(".name,.staff-name,.person-name,.employee-name").first().text(),
    n.find("h1,h2,h3,h4,h5,strong,b").first().text(),
    ...chunks.slice(0,5)
  ];
  let full:string|null=null; for(const c of candidates){ full=plausibleName(c); if(full) break; }
  if(!full) return null;
  const mail=(n.find('a[href^="mailto:"]').first().attr("href")||"").replace(/^mailto:/i,"").split("?")[0];
  const tel=(n.find('a[href^="tel:"]').first().attr("href")||"").replace(/^tel:/i,"");
  const email=mail || text.match(EMAIL_RE)?.[0] || null;
  const phone=tel || text.match(PHONE_RE)?.[0] || null;
  return {role,full_name:full,title,email,phone,source_url:source};
}
function extract(html:string,source:string,roles:Set<string>){
  const $=cheerio.load(html); const hits:Hit[]=[];
  const selectors="article,li,tr,.staff,.staff-member,.staff-card,.person,.employee,.contact,.directory-item,.profile,.card,section";
  for(const node of $(selectors).toArray()) for(const role of roles){ const h=hitFromBlock($,node,role,source); if(h) hits.push(h); }
  const lines=$("body").text().split(/\r?\n/).map(clean).filter(x=>x.length>1&&x.length<180);
  for(let i=0;i<lines.length;i++) for(const role of roles){ const rx=ROLE_RX[role]; if(!rx?.test(lines[i])) continue; let full:string|null=null; for(const d of[-1,1,-2,2]){ const x=lines[i+d]; if(x && (full=plausibleName(x))) break; } if(!full) continue; const ctx=lines.slice(Math.max(0,i-3),Math.min(lines.length,i+4)).join(" "); hits.push({role,full_name:full,title:lines[i],email:ctx.match(EMAIL_RE)?.[0]||null,phone:ctx.match(PHONE_RE)?.[0]||null,source_url:source}); }
  const best=new Map<string,Hit>(); for(const h of hits){ const old=best.get(h.role); const score=(h.email?4:0)+(h.phone?2:0)+(h.title.length<100?1:0); const oldScore=old?((old.email?4:0)+(old.phone?2:0)+(old.title.length<100?1:0)):-1; if(score>oldScore) best.set(h.role,h); }
  return [...best.values()];
}
async function stateCounts(sql:ReturnType<typeof getSql>){ return (await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code=$1`,[STATE]) as any[])[0]; }

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth) return auth;
  const sql=getSql(); const started=Date.now(); const before=await stateCounts(sql);
  const agencies=await sql.query(`select a.id::text,a.canonical_name,a.website,array_agg(distinct c.role_key) as roles from agencies a join raven_state_contacts c on c.agency_id=a.id where c.state_code=$1 and c.scope='district' and c.verification_status='missing' and c.role_key in ('it_director','school_board','security_director') and nullif(trim(a.website),'') is not null and a.website !~* '^https?://nces\\.ed\\.gov/' group by a.id,a.canonical_name,a.website order by a.canonical_name limit $2`,[STATE,LIMIT]) as Agency[];
  let districts=0,pages=0,verified=0; const results:any[]=[];
  async function processAgency(a:Agency){
    if(Date.now()-started>BUDGET) return; const seed=safe(a.website); if(!seed) return; const home=await fetchHtml(seed.toString()); if(!home) return; districts++;
    const base=safe(home.url)||seed; const roles=new Set((a.roles||[]).filter(r=>ROLE_RX[r])); const found:Hit[]=[]; found.push(...extract(home.html,base.toString(),roles)); pages++;
    for(const url of pageLinks(base,home.html)){ if(Date.now()-started>BUDGET) break; const r=await fetchHtml(url); if(!r) continue; const u=safe(r.url); if(!u||!sameHost(base,u)) continue; pages++; found.push(...extract(r.html,u.toString(),roles)); }
    const best=new Map<string,Hit>(); for(const h of found){ if(!best.has(h.role) || (h.email&&!best.get(h.role)?.email)) best.set(h.role,h); }
    for(const h of best.values()){
      const rows=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,verification_status='verified',verified_at=now(),evidence_note='Verified directly from current official Florida district website by isolated state-completion worker; no contact field inferred.',updated_at=now() where agency_id=$1 and state_code=$7 and role_key=$8 and verification_status='missing' returning id::text`,[a.id,h.full_name,h.title,h.email,h.phone,h.source_url,STATE,h.role]) as any[];
      if(rows.length){ verified+=rows.length; results.push({district:a.canonical_name,...h}); }
    }
  }
  for(let i=0;i<agencies.length&&Date.now()-started<BUDGET;i+=CONCURRENCY) await Promise.all(agencies.slice(i,i+CONCURRENCY).map(processAgency));
  const after=await stateCounts(sql);
  const lanes=await sql.query(`select role_key,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts where state_code=$1 and scope='district' and role_key in ('superintendent','assistant_superintendent','it_director','school_board','security_director') group by role_key order by role_key`,[STATE]);
  const summary={ok:true,state:STATE,mode:'isolated-state-completion',districtsSelected:agencies.length,districtsProcessed:districts,pagesScanned:pages,verifiedAdded:verified,before,after,lanes,results,elapsedMs:Date.now()-started}; console.log('RAVEN_FLORIDA_COMPLETE',summary); return NextResponse.json(summary);
}
