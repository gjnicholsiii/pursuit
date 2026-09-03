import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const url="https://oeds.education.ohio.gov/DataExtract";
  const res=await fetch(url,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/6.2; authoritative-state-roster)",accept:"text/html,application/xhtml+xml"}});
  const html=await res.text();
  const $=cheerio.load(html);
  const forms=$("form").map((_,f)=>({
    action:$(f).attr("action")||"",method:$(f).attr("method")||"GET",id:$(f).attr("id")||"",
    inputs:$(f).find("input,button,select").map((__,el)=>({tag:el.tagName,name:$(el).attr("name")||"",id:$(el).attr("id")||"",type:$(el).attr("type")||"",value:$(el).attr("value")||"",text:$(el).is("button")?$(el).text().replace(/\s+/g," ").trim():"",context:$(el).closest("label,div,tr,li").text().replace(/\s+/g," ").trim().slice(0,240)})).get().filter((x:any)=>/public district|generate report|role|email|phone|superintendent|district|extract/i.test(`${x.name} ${x.id} ${x.value} ${x.text} ${x.context}`)).slice(0,200)
  })).get();
  const scripts=$("script[src]").map((_,s)=>$(s).attr("src")).get();
  const result={ok:res.ok,status:res.status,finalUrl:res.url,htmlBytes:html.length,forms,scripts};
  console.log("RAVEN_OHIO_OEDS_PROBE",JSON.stringify(result));
  return NextResponse.json(result);
}
