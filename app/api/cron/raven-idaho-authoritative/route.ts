import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ROSTER = "https://www.sde.idaho.gov/school-districts/";
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

type Counts = { total:number; verified:number; candidate:number; missing:number; rejected:number };
type Slot = { id:string; agency_id:string; canonical_name:string; nces_id:string|null };
type Site = { label:string; url:string };
type Person = { fullName:string; title:string; sourceUrl:string };

async function counts(sql:ReturnType<typeof getSql>):Promise<Counts>{
  const rows=await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[];
  return rows[0] as Counts;
}
function norm(v:string){return (v||"").toLowerCase().replace(/\b(idaho|public|school|schools|district|joint|independent|county|elementary)\b/g," ").replace(/#\s*0*(\d+)/g," $1 ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function lines(html:string){return html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?\s*>/gi,"\n").replace(/<\/(p|div|li|h[1-6]|tr|td|section|article|dt|dd)>/gi,"\n").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);}
function plausible(raw:string){const s=raw.replace(/\s+/g," ").replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i,"").trim();if(s.length<5||s.length>70||/superintendent|district|school|office|administration|leadership|welcome|board/i.test(s))return null;const p=s.split(/\s+/);if(p.length<2||p.length>5||!p.every(x=>/^[A-Za-z][A-Za-z.'-]*$/.test(x)))return null;return s;}
async function fetchHtml(url:string,timeout=9000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{headers:HEADERS,cache:"no-store",redirect:"follow",signal:c.signal});return {ok:r.ok,status:r.status,url:r.url||url,html:await r.text()};}catch{return {ok:false,status:0,url,html:""};}finally{clearTimeout(t);}}
function parseSites(html:string){const $=cheerio.load(html);const out:Site[]=[];$("a[href]").each((_,el)=>{const label=$(el).text().replace(/\s+/g," ").trim();const href=$(el).attr("href")||"";if(!/district\s*#?\s*\d+|school district/i.test(label))return;try{const u=new URL(href,ROSTER);const host=u.hostname.toLowerCase();if(!/^https?:$/.test(u.protocol)||host.endsWith("sde.idaho.gov")||/facebook|instagram|twitter|youtube|linkedin/.test(host))return;out.push({label,url:u.toString()});}catch{}});return [...new Map(out.map(x=>[`${norm(x.label)}|${x.url}`,x])).values()];}
function superintendent(html:string,sourceUrl:string):Person|null{const $=cheerio.load(html);const blocks=$("article,li,tr,.staff,.staff-member,.staff-card,.person,.employee,.directory-item,.profile,.card,section").toArray();for(const el of blocks){const n=$(el);const txt=n.text().replace(/\s+/g," ").trim();if(txt.length<10||txt.length>700||!/\b(?:interim\s+)?superintendent\b/i.test(txt)||/assistant\s+superintendent/i.test(txt))continue;const pieces=[n.find("h1,h2,h3,h4,.name,.staff-name,.person-name,strong,b").first().text(),...lines(n.html()||"").slice(0,10)];for(const piece of pieces){const fullName=plausible(piece);if(fullName)return {fullName,title:(txt.match(/(?:interim\s+)?superintendent/i)||["Superintendent"])[0],sourceUrl};}}
  const ls=lines(html);for(let i=0;i<ls.length;i++){if(!/^(?:office of the )?(?:interim )?superintendent\b/i.test(ls[i])&&!/\b(?:interim )?superintendent\b/i.test(ls[i]))continue;if(/assistant\s+superintendent/i.test(ls[i]))continue;for(let d=1;d<=4;d++){for(const j of [i-d,i+d]){if(j<0||j>=ls.length)continue;const fullName=plausible(ls[j]);if(fullName)return {fullName,title:"Superintendent",sourceUrl};}}}return null;}
async function inspectSite(site:Site):Promise<Person|null>{const home=await fetchHtml(site.url,7000);if(!home.ok)return null;let p=superintendent(home.html,home.url);if(p)return p;const $=cheerio.load(home.html);const links:string[]=[];$("a[href]").each((_,el)=>{const label=$(el).text().replace(/\s+/g," ").trim();const href=$(el).attr("href")||"";if(!/superintendent|administration|leadership|district office/i.test(`${label} ${href}`))return;try{const u=new URL(href,home.url);if(u.hostname.replace(/^www\./,"")===new URL(home.url).hostname.replace(/^www\./,""))links.push(u.toString());}catch{}});for(const url of [...new Set(links)].slice(0,4)){const r=await fetchHtml(url,7000);if(!r.ok)continue;p=superintendent(r.html,r.url);if(p)return p;}return null;}
function siteFor(slot:Slot,sites:Site[]){const n=norm(slot.canonical_name);const number=(slot.canonical_name.match(/#\s*0*(\d+)/)||slot.canonical_name.match(/district\s*0*(\d+)/i)||[])[1];const matches=sites.filter(s=>{const x=norm(s.label);if(number&&new RegExp(`(?:^| )${Number(number)}(?: |$)`).test(x))return true;return x===n||(x.length>=5&&n.length>=5&&(x.includes(n)||n.includes(x)));});return matches.length===1?matches[0]:null;}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req);if(auth)return auth;const sql=getSql();const before=await counts(sql);
  const slots=await sql.query(`select c.id::text,c.agency_id::text,a.canonical_name,a.nces_id from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code='ID' and c.scope='district' and c.role_key='superintendent' and c.verification_status in ('missing','rejected') order by a.canonical_name`) as Slot[];
  const missingBefore=slots.length;if(!slots.length)return NextResponse.json({ok:true,state:"ID",missingBefore:0,missingAfter:0,districtsProcessedInBulk:0,districtsNewlyAttempted:0,filled:0,before,after:before,net:{total:0,verified:0,candidate:0,missing:0,rejected:0},exhausted:true});
  const roster=await fetchHtml(ROSTER,12000);if(!roster.ok){console.error("RAVEN_ID_AUTHORITATIVE_FETCH",ROSTER,`HTTP ${roster.status}`);return NextResponse.json({ok:false,state:"ID",source:ROSTER,blocker:`Idaho DOE statewide district roster HTTP ${roster.status}`,districtsNewlyAttempted:0,before},{status:502});}
  const sites=parseSites(roster.html);if(sites.length<100){console.error("RAVEN_ID_AUTHORITATIVE_GUARD",{sites:sites.length});return NextResponse.json({ok:false,state:"ID",source:ROSTER,blocker:`Only ${sites.length} district links parsed from Idaho DOE roster; refusing partial statewide run`,districtsNewlyAttempted:0,before},{status:502});}
  const work=slots.map(slot=>({slot,site:siteFor(slot,sites)})).filter((x):x is {slot:Slot;site:Site}=>!!x.site);
  const hits=new Map<string,Person>();let attempted=0;for(let i=0;i<work.length;i+=12){const batch=work.slice(i,i+12);const found=await Promise.all(batch.map(async x=>{attempted++;return {id:x.slot.id,p:await inspectSite(x.site)};}));for(const x of found)if(x.p)hits.set(x.id,x.p);}
  let filled=0;for(const slot of slots){const p=hits.get(slot.id);if(!p)continue;const rows=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=null,phone=null,source_url=$4,verification_status='candidate',evidence_note=$5,updated_at=now() where id=$1 and role_key='superintendent' and verification_status in ('missing','rejected') returning id`,[slot.id,p.fullName,p.title,p.sourceUrl,'Current superintendent published on the official district website reached from the Idaho Department of Education statewide district roster. No email inferred.']) as any[];filled+=rows.length;}
  const after=await counts(sql);const missingAfter=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='ID' and scope='district' and role_key='superintendent' and verification_status='missing'`) as any[])[0]?.n||0;
  const summary={ok:true,state:"ID",source:ROSTER,statewideDistrictLinks:sites.length,missingBefore,missingAfter,districtsProcessedInBulk:slots.length,districtsNewlyAttempted:attempted,matchedDistrictSites:work.length,filled,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};console.log("RAVEN_ID_AUTHORITATIVE",summary);return NextResponse.json(summary);
}
