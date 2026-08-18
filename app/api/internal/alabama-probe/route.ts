import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const ENTRY = "https://procurement.staars.alabama.gov/PRDVSS1X1/AltSelfService";
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

function cookieHeader(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(v => v.split(";",1)[0]).join("; ");
}

function formData(html:string,name?:string){
  const $=load(html); const form=name?$(`form[name='${name}'],form#${name}`).first():$("form").first();
  const params=new URLSearchParams(); form.find("input[type='hidden']").each((_,el)=>{const n=$(el).attr("name");if(n)params.append(n,$(el).attr("value")||"");});
  return {params,action:form.attr("action")||""};
}

async function post(action:string,params:URLSearchParams,cookie:string,referer:string){
  const url=new URL(action||ENTRY,referer).toString();
  const r=await fetch(url,{method:"POST",headers:{accept:"text/html,application/xhtml+xml","content-type":"application/x-www-form-urlencoded","user-agent":UA,referer,origin:new URL(url).origin,...(cookie?{cookie}:{})},body:params.toString(),redirect:"follow",cache:"no-store"});
  return {r,html:await r.text(),cookie:cookieHeader(r)||cookie};
}

export async function GET(){
  const first=await fetch(ENTRY,{headers:{accept:"text/html","user-agent":UA},redirect:"follow",cache:"no-store"}); const firstHtml=await first.text(); let cookie=cookieHeader(first);
  const login=formData(firstHtml,"login_form"); login.params.set("guest_login","Public Access"); const guest=await post(login.action,login.params,cookie,first.url); cookie=guest.cookie;
  const $g=load(guest.html); const startupSrc=$g("frame[name='Startup']").attr("src")||"";
  if(!startupSrc) return NextResponse.json({stage:"guest",status:guest.r.status,url:guest.r.url,forms:$g("form").map((_,f)=>({name:$g(f).attr("name"),action:$g(f).attr("action")})).get(),body:$g("body").text().replace(/\s+/g," ").trim().slice(0,4000),html:guest.html.slice(0,8000)});
  const startupUrl=new URL(startupSrc,$g("base").attr("href")||guest.r.url).toString(); const sr=await fetch(startupUrl,{headers:{accept:"text/html","user-agent":UA,referer:guest.r.url,...(cookie?{cookie}:{})},cache:"no-store"}); const startupHtml=await sr.text(); cookie=cookieHeader(sr)||cookie;
  const enter=formData(startupHtml,"StartupPage"); enter.params.set("frame_name","Display"); enter.params.set("query_string",'menu_action=menu_action&ams_action=13&ams_destination="pCombSolicitation_Search"&ams_whereclause=""&ams_framesetpagename=""&ams_framename="Display"&ams_applname="VSS"&&ams_orderbyclause=""&ams_pagecode="SOSRCH"');
  const search=await post(enter.action,enter.params,cookie,sr.url); cookie=search.cookie;
  const openForm=formData(search.html,"pCombSolicitation_Search"); openForm.params.set("frame_name","Display"); openForm.params.set("query_string","AMSBrowseOpenSolicit=AMSBrowseOpenSolicit");
  const open=await post(openForm.action,openForm.params,cookie,search.r.url); const $=load(open.html);
  return NextResponse.json({statuses:{first:first.status,guest:guest.r.status,startup:sr.status,search:search.r.status,open:open.r.status},urls:{guest:guest.r.url,startup:sr.url,search:search.r.url,open:open.r.url},forms:$("form").map((_,f)=>({name:$(f).attr("name")||$(f).attr("id"),action:$(f).attr("action")})).get(),rowCurrency:$("tr[rowcurrency]").length,docRefs:(open.html.match(/var\s+lsDocReference\s*=\s*\[([^\]]*)\]/i)||[])[1]||null,bodyText:$("body").text().replace(/\s+/g," ").trim().slice(0,7000),htmlStart:open.html.slice(0,10000)});
}
