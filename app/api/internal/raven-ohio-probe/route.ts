import * as cheerio from "cheerio";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(){
  const url="https://oeds.education.ohio.gov/DataExtract";
  const res=await fetch(url,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/6.1; authoritative-directory-probe)",accept:"text/html,application/xhtml+xml"}});
  const html=await res.text();
  const $=cheerio.load(html);
  const forms=$("form").map((_,f)=>({action:$(f).attr("action")||"",method:$(f).attr("method")||"GET",id:$(f).attr("id")||"",inputs:$(f).find("input,button,select").map((__,el)=>({tag:el.tagName,name:$(el).attr("name")||"",id:$(el).attr("id")||"",type:$(el).attr("type")||"",value:$(el).attr("value")||"",text:$(el).is("button")?$(el).text().trim():"",context:$(el).closest("label,div,tr,li").text().replace(/\s+/g," ").trim().slice(0,180)})).get().filter((x:any)=>/public district|generate report|role|email|phone|superintendent|district/i.test(`${x.name} ${x.id} ${x.value} ${x.text} ${x.context}`)).slice(0,120)})).get();
  const scripts=$("script[src]").map((_,s)=>$(s).attr("src")).get();
  return NextResponse.json({status:res.status,url:res.url,forms,scripts});
}
