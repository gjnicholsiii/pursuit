import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const ROOT = "https://procurement.staars.alabama.gov";
const ENTRY = `${ROOT}/PRDVSS1X1/AltSelfService`;
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

function cookies(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(v => v.split(";",1)[0]).join("; ");
}

function hidden(html:string, formName?:string) {
  const $=load(html); const form=formName?$(`form[name='${formName}']`).first():$("form").first(); const p=new URLSearchParams();
  form.find("input[type='hidden']").each((_,el)=>{ const n=$(el).attr("name"); if(n)p.append(n,$(el).attr("value")||""); }); return p;
}

async function post(params:URLSearchParams,cookie:string,referer:string){
  const r=await fetch(ENTRY,{method:"POST",headers:{accept:"text/html,application/xhtml+xml","content-type":"application/x-www-form-urlencoded","user-agent":UA,referer,origin:ROOT,...(cookie?{cookie}:{})},body:params.toString(),redirect:"follow",cache:"no-store"});
  return {r,html:await r.text(),cookie:cookies(r)||cookie};
}

export async function GET(){
  const first=await fetch(ENTRY,{headers:{accept:"text/html","user-agent":UA},redirect:"follow",cache:"no-store"}); const firstHtml=await first.text(); let cookie=cookies(first);
  const login=hidden(firstHtml,"login_form"); login.set("guest_login","Public Access"); const guest=await post(login,cookie,first.url||ENTRY); cookie=guest.cookie;
  const $g=load(guest.html); const base=$g("base").attr("href")||guest.r.url; const startupSrc=$g("frame[name='Startup']").attr("src")||""; const startupUrl=new URL(startupSrc,base).toString();
  const sr=await fetch(startupUrl,{headers:{accept:"text/html","user-agent":UA,referer:guest.r.url,...(cookie?{cookie}:{})},cache:"no-store"}); const startupHtml=await sr.text(); cookie=cookies(sr)||cookie;
  const enter=hidden(startupHtml,"StartupPage"); enter.set("frame_name","Display"); enter.set("query_string",'menu_action=menu_action&ams_action=13&ams_destination="pCombSolicitation_Search"&ams_whereclause=""&ams_framesetpagename=""&ams_framename="Display"&ams_applname="VSS"&&ams_orderbyclause=""&ams_pagecode="SOSRCH"');
  const search=await post(enter,cookie,sr.url); cookie=search.cookie;
  const openParams=hidden(search.html,"pCombSolicitation_Search"); openParams.set("frame_name","Display"); openParams.set("query_string","AMSBrowseOpenSolicit=AMSBrowseOpenSolicit");
  const open=await post(openParams,cookie,search.r.url); const $=load(open.html);
  const forms=$("form").map((_,f)=>$(f).attr("name")||$(f).attr("id")||"unnamed").get();
  const tables=$("table").map((_,t)=>({id:$(t).attr("id")||null,cls:$(t).attr("class")||null,rows:$(t).find("tr").length,text:$(t).text().replace(/\s+/g," ").trim().slice(0,300)})).get().slice(0,20);
  const inputs=$("input").map((_,i)=>({name:$(i).attr("name")||null,type:$(i).attr("type")||null,value:$(i).attr("value")||null})).get().filter(x=>x.name).slice(0,120);
  const rowCurrency=$("tr[rowcurrency]").length;
  const docRefs=(open.html.match(/var\s+lsDocReference\s*=\s*\[([^\]]*)\]/i)||[])[1]||null;
  const bodyText=$("body").text().replace(/\s+/g," ").trim().slice(0,5000);
  return NextResponse.json({statuses:{first:first.status,guest:guest.r.status,startup:sr.status,search:search.r.status,open:open.r.status},urls:{first:first.url,guest:guest.r.url,startup:sr.url,search:search.r.url,open:open.r.url},forms,rowCurrency,docRefs,tables,inputs,bodyText,htmlStart:open.html.slice(0,12000)});
}
