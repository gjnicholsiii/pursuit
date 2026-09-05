import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INDEX = "https://datacenter.ride.ri.gov/Directory/Index";
const BASE = "https://datacenter.ride.ri.gov/Directory/LEADetail?orgid=";
const DISTRICTS = "https://ride.ri.gov/students-families/ri-public-schools/school-districts";
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

type Counts = { total:number; verified:number; candidate:number; missing:number; rejected:number };
type Slot = { id:string; agency_id:string; canonical_name:string; nces_id:string|null };
type Parsed = { leaName:string; ncesId:string; fullName:string; title:string; sourceUrl:string };
type DistrictSite = { label:string; url:string };

async function counts(sql:ReturnType<typeof getSql>):Promise<Counts>{
  const rows = await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[];
  return rows[0] as Counts;
}

function decode(s:string){return s.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/&#8211;|&#8212;|&ndash;|&mdash;/gi,"-");}
function textLines(html:string){return decode(html).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?\s*>/gi,"\n").replace(/<\/(p|div|li|h[1-6]|tr|td|section|article|dt|dd)>/gi,"\n").replace(/<[^>]+>/g," ").split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);}
function norm(v:string){return (v||"").toLowerCase().replace(/\b(public|school|schools|department|district|regional|charter|academy|the|ri|rhode island)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();}
function plausibleName(raw:string){const s=raw.replace(/\s+/g," ").replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i,"").trim();if(s.length<5||s.length>70||/superintendent|district|school|office|welcome|administration|leadership/i.test(s))return null;const p=s.split(/\s+/);if(p.length<2||p.length>5||!p.every(x=>/^[A-Za-z][A-Za-z.'-]*$/.test(x)))return null;return s;}
function parseRideDetail(html:string,orgid:number):Parsed|null{
  const ls=textLines(html);const ncesLine=ls.find(x=>/^NCES Code:/i.test(x));if(!ncesLine)return null;
  const ncesId=(ncesLine.match(/NCES Code:\s*([0-9]+)/i)||[])[1]||"";if(!ncesId)return null;
  const ni=ls.indexOf(ncesLine);let leaName="";for(let i=ni-1;i>=0&&i>=ni-10;i--){const x=ls[i];if(/^(LEA Information|LEA Code:|LEA Type:|Grade Span:|Status:|Location|Directory)/i.test(x))continue;if(x.length>1){leaName=x;break;}}
  for(let i=0;i<ls.length;i++){if(!/^Role\(s\):\s*Superintendent\b/i.test(ls[i]))continue;let title="",fullName="";for(let j=i-1;j>=0&&j>=i-8;j--){if(!title&&/^Title:\s*/i.test(ls[j])){title=ls[j].replace(/^Title:\s*/i,"").trim();continue;}if(title&&!/^Title:|^Contact\(s\)|^Role\(s\):/i.test(ls[j])){fullName=ls[j].trim();break;}}if(fullName&&/superintendent/i.test(title))return {leaName,ncesId,fullName,title,sourceUrl:`${BASE}${orgid}`};}
  return null;
}
async function fetchHtml(url:string,timeout=9000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{headers:HEADERS,cache:"no-store",redirect:"follow",signal:c.signal});return {ok:r.ok,status:r.status,url:r.url||url,html:await r.text()};}catch{return {ok:false,status:0,url,html:""};}finally{clearTimeout(t);}}
async function fetchRideDetails(){const idx=await fetchHtml(INDEX);const ids=new Set<number>();for(const m of idx.html.matchAll(/(?:LEADetail\?orgid=|LEADetail\?orgid%3D)(\d+)/gi))ids.add(Number(m[1]));const parsed:Parsed[]=[];let detailHttpOk=0;for(let i=0;i<[...ids].length;i+=20){const batch=await Promise.all([...ids].slice(i,i+20).map(async id=>{const r=await fetchHtml(`${BASE}${id}`);if(r.ok)detailHttpOk++;return r.ok?parseRideDetail(r.html,id):null;}));for(const p of batch)if(p)parsed.push(p);}return {indexStatus:idx.status,indexOk:idx.ok,ids:ids.size,detailHttpOk,parsed};}
function extractDistrictSites(html:string){const $=cheerio.load(html);const out=new Map<string,DistrictSite>();$("a[href]").each((_,el)=>{const label=$(el).text().replace(/\s+/g," ").trim();const href=$(el).attr("href")||"";if(!label||label.length>100)return;try{const u=new URL(href,DISTRICTS);const host=u.hostname.toLowerCase();if(!/^https?:$/.test(u.protocol)||host.endsWith("ride.ri.gov")||host.endsWith("ri.gov")||/facebook|twitter|instagram|youtube|linkedin/.test(host))return;const key=norm(label);if(key.length>=3&&!out.has(key))out.set(key,{label,url:u.toString()});}catch{}});return [...out.values()];}
function superintendentFromHtml(html:string,sourceUrl:string):Parsed|null{const $=cheerio.load(html);const nodes=$("article,li,tr,.staff,.staff-member,.staff-card,.person,.employee,.directory-item,.profile,.card,section").toArray();for(const el of nodes){const n=$(el),txt=n.text().replace(/\s+/g," ").trim();if(txt.length<10||txt.length>700||!/\b(superintendent|interim superintendent|district superintendent)\b/i.test(txt))continue;const pieces=[n.find("h1,h2,h3,h4,.name,.staff-name,.person-name,strong,b").first().text(),...textLines(n.html()||"").slice(0,8)];for(const piece of pieces){const nm=plausibleName(piece);if(nm)return {leaName:"",ncesId:"",fullName:nm,title:(txt.match(/(?:interim\s+)?(?:district\s+)?superintendent/i)||["Superintendent"])[0],sourceUrl};}}
  const ls=textLines(html);for(let i=0;i<ls.length;i++){if(!/^(?:office of the )?(?:interim )?(?:district )?superintendent\b/i.test(ls[i])&&!/\b(?:interim )?superintendent\b/i.test(ls[i]))continue;for(let d=1;d<=4;d++){for(const j of [i-d,i+d]){if(j<0||j>=ls.length)continue;const nm=plausibleName(ls[j]);if(nm)return {leaName:"",ncesId:"",fullName:nm,title:"Superintendent",sourceUrl};}}}return null;}
async function districtFallback(slots:Slot[]){const roster=await fetchHtml(DISTRICTS);if(!roster.ok)return {rosterStatus:roster.status,sites:0,attempted:0,parsed:[] as Array<{slot:Slot;person:Parsed}>};const sites=extractDistrictSites(roster.html);const results:Array<{slot:Slot;person:Parsed}>=[];let attempted=0;for(const slot of slots){const n=norm(slot.canonical_name);const matches=sites.filter(s=>{const x=norm(s.label);return x===n||(x.length>=4&&n.length>=4&&(x.includes(n)||n.includes(x)));});if(matches.length!==1)continue;attempted++;const site=matches[0];const home=await fetchHtml(site.url,6500);if(!home.ok)continue;let person=superintendentFromHtml(home.html,home.url);if(!person){const $=cheerio.load(home.html);const links:string[]=[];$("a[href]").each((_,el)=>{const label=$(el).text().replace(/\s+/g," ").trim();const href=$(el).attr("href")||"";if(!/superintendent|administration|leadership/i.test(`${label} ${href}`))return;try{const u=new URL(href,home.url);if(u.hostname.replace(/^www\./,"")===new URL(home.url).hostname.replace(/^www\./,""))links.push(u.toString());}catch{}});for(const url of [...new Set(links)].slice(0,3)){const p=await fetchHtml(url,6500);if(!p.ok)continue;person=superintendentFromHtml(p.html,p.url);if(person)break;}}
    if(person)results.push({slot,person});}
  return {rosterStatus:roster.status,sites:sites.length,attempted,parsed:results};}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req);if(auth)return auth;const sql=getSql();const before=await counts(sql);
  const slots=await sql.query(`select c.id::text,c.agency_id::text,a.canonical_name,a.nces_id from raven_state_contacts c join agencies a on a.id=c.agency_id where c.state_code='RI' and c.scope='district' and c.role_key='superintendent' and c.verification_status in ('missing','rejected')`) as Slot[];
  const missingBefore=slots.length;if(!slots.length)return NextResponse.json({ok:true,state:"RI",missingBefore:0,missingAfter:0,districtsProcessedInBulk:0,filled:0,before,after:before,net:{total:0,verified:0,candidate:0,missing:0,rejected:0},exhausted:true});
  const ride=await fetchRideDetails();const byNces=new Map(ride.parsed.map(r=>[r.ncesId,r]));const hits=new Map<string,Parsed>();for(const slot of slots){let hit=slot.nces_id?byNces.get(slot.nces_id):undefined;if(!hit){const n=norm(slot.canonical_name);const m=ride.parsed.filter(r=>norm(r.leaName)===n);if(m.length===1)hit=m[0];}if(hit)hits.set(slot.id,hit);}
  let fallback:any=null;if(hits.size===0||!ride.indexOk){fallback=await districtFallback(slots.filter(s=>!hits.has(s.id)));for(const r of fallback.parsed)hits.set(r.slot.id,r.person);}
  let filled=0;for(const slot of slots){const hit=hits.get(slot.id);if(!hit)continue;const rows=await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=null,phone=null,source_url=$4,verification_status='candidate',evidence_note=$5,updated_at=now() where id=$1 and role_key='superintendent' and verification_status in ('missing','rejected') returning id`,[slot.id,hit.fullName,hit.title,hit.sourceUrl,hit.sourceUrl.includes('ride.ri.gov')||hit.sourceUrl.includes('datacenter.ride.ri.gov')?'Current superintendent published by an authoritative Rhode Island education source. No email inferred.':'Current superintendent published on the official district website reached from the RIDE statewide district roster. No email inferred.']) as any[];filled+=rows.length;}
  const after=await counts(sql);const remain=(await sql.query(`select count(*)::int n from raven_state_contacts where state_code='RI' and scope='district' and role_key='superintendent' and verification_status='missing'`) as any[])[0]?.n||0;
  const summary={ok:true,state:"RI",primarySource:INDEX,fallbackSource:DISTRICTS,indexStatus:ride.indexStatus,indexOk:ride.indexOk,authoritativeOrgIds:ride.ids,authoritativePagesParsed:ride.parsed.length,fallbackRosterStatus:fallback?.rosterStatus??null,fallbackDistrictSites:fallback?.sites??0,missingBefore,missingAfter:remain,districtsProcessedInBulk:slots.length,districtSitesNewlyAttempted:fallback?.attempted??0,filled,before,after,net:{total:after.total-before.total,verified:after.verified-before.verified,candidate:after.candidate-before.candidate,missing:after.missing-before.missing,rejected:after.rejected-before.rejected}};
  console.log("RAVEN_RI_AUTHORITATIVE",summary);return NextResponse.json(summary);
}
