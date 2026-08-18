import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const ROOT = "https://mevss.hostams.com";
const ENTRY = `${ROOT}/PRDVSS1X1/AltSelfService`;
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

function text(v: unknown) { return String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
function cookiePairs(r: Response) { const v = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : []; const f = r.headers.get("set-cookie"); return (v.length ? v : f ? [f] : []).map(x => x.split(";", 1)[0]).filter(Boolean); }
function mergeCookies(...sets: string[][]) { const map = new Map<string,string>(); for (const set of sets) for (const pair of set) { const eq = pair.indexOf("="); if (eq > 0) map.set(pair.slice(0,eq), pair); } return [...map.values()]; }
function hiddenParams(html: string, formName?: string) { const $ = load(html); const form = formName ? $(`form[name='${formName}']`).first() : $("form").first(); const p = new URLSearchParams(); form.find("input[type='hidden']").each((_,i)=>{ const n=$(i).attr("name"); if(n)p.append(n,$(i).attr("value")||""); }); return p; }
async function post(params: URLSearchParams, cookies: string[], referer: string) { return fetch(ENTRY,{method:"POST",headers:{accept:"text/html,application/xhtml+xml","content-type":"application/x-www-form-urlencoded","user-agent":UA,referer,origin:ROOT,...(cookies.length?{cookie:cookies.join("; ")}:{})},body:params.toString(),redirect:"follow",cache:"no-store"}); }
function refs(html:string){ const m=html.match(/var\s+lsDocReference\s*=\s*\[([^\]]*)\]/i); return m?[...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x=>x[1]).filter(v=>v.trim()):[]; }
function nav(html:string){ const $=load(html); const next=$("input[name='T1SO_SRCH_QRYnextpage']").first(); return {exists:next.length>0,disabled:next.is(":disabled")||next.attr("disabled")!==undefined||/disabled/i.test(next.attr("class")||""),class:next.attr("class")||null}; }
function rows(html:string){
  const $=load(html);
  return $("input[name*='T1SO_SRCH_QRYpagenav']").toArray().map(input=>{
    const row=$(input).closest("tr"); const parent=row.parent().closest("tr");
    return {name:$(input).attr("name")||null,rowText:text(row.text()),parentRowText:text(parent.text()).slice(0,2500)};
  });
}

export async function GET(){
  const first=await fetch(ENTRY,{headers:{accept:"text/html","user-agent":UA},redirect:"follow",cache:"no-store"}); const firstHtml=await first.text(); let cookies=cookiePairs(first);
  const login=hiddenParams(firstHtml,"login_form"); login.set("guest_login","Public Access"); const guest=await post(login,cookies,first.url||ENTRY); const guestHtml=await guest.text(); cookies=mergeCookies(cookies,cookiePairs(guest));
  const g=load(guestHtml); const base=g("base").attr("href")||guest.url; const startupUrl=new URL(g("frame[name='Startup']").attr("src")||"",base).toString();
  const startup=await fetch(startupUrl,{headers:{accept:"text/html","user-agent":UA,referer:guest.url,...(cookies.length?{cookie:cookies.join("; ")}:{})},cache:"no-store"}); const startupHtml=await startup.text(); cookies=mergeCookies(cookies,cookiePairs(startup));
  const enter=hiddenParams(startupHtml,"StartupPage"); enter.set("frame_name","Display"); enter.set("query_string",'menu_action=menu_action&ams_action=13&ams_destination="pCombSolicitation_Search"&ams_whereclause=""&ams_framesetpagename=""&ams_framename="Display"&ams_applname="VSS"&&ams_orderbyclause=""&ams_pagecode="SOSRCH"');
  const search=await post(enter,cookies,startup.url); const searchHtml=await search.text(); cookies=mergeCookies(cookies,cookiePairs(search));
  const openParams=hiddenParams(searchHtml,"pCombSolicitation_Search"); openParams.set("frame_name","Display"); openParams.set("query_string","AMSBrowseOpenSolicit=AMSBrowseOpenSolicit");
  const open=await post(openParams,cookies,search.url); let html=await open.text(); cookies=mergeCookies(cookies,cookiePairs(open));

  const sampleRows=rows(html); const pages: Array<{page:number;refs:string[];nav:ReturnType<typeof nav>}> = []; const all:string[]=[];
  for(let page=1;page<=100;page++){
    const r=refs(html); const n=nav(html); pages.push({page,refs:r,nav:n}); all.push(...r);
    if(!n.exists||n.disabled||r.length===0)break;
    const p=hiddenParams(html,"pCombSolicitation_Search"); p.set("T1SO_SRCH_QRYnextpage","Next"); const next=await post(p,cookies,ENTRY); html=await next.text(); cookies=mergeCookies(cookies,cookiePairs(next));
  }
  const unique=[...new Set(all)];
  return NextResponse.json({pagesFetched:pages.length,totalRefs:all.length,uniqueRefs:unique.length,duplicates:all.length-unique.length,sampleRows,lastPage:pages.at(-1),pageCounts:pages.map(p=>p.refs.length),firstRefs:pages[0]?.refs||[],lastRefs:pages.at(-1)?.refs||[]});
}
