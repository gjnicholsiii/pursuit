import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const url = "https://houstonisd.ionwave.net/SourcingEvents.aspx?SourceType=1";
  const initial = await fetch(url, { cache:"no-store", headers:{"user-agent":"Mozilla/5.0"} });
  const html = await initial.text();
  const cookie = initial.headers.get("set-cookie") || "";
  const $ = cheerio.load(html);
  const baseFields: Record<string,string> = {};
  $("form input[name]").each((_, el) => {
    const name = $(el).attr("name");
    if (!name) return;
    const type = ($(el).attr("type") || "").toLowerCase();
    if (["submit","button","image","file"].includes(type)) return;
    baseFields[name] = $(el).attr("value") || "";
  });
  const args = ["RowClick;0","RowClick:0","RowClick$0","RowClick|0","RowClick,0","RowClick","0"];
  const results = [];
  for (const eventArgument of args) {
    const fields = { ...baseFields, __EVENTTARGET:"ctl00$mainContent$rgBidList", __EVENTARGUMENT:eventArgument };
    const r = await fetch(url, {
      method:"POST", redirect:"manual", cache:"no-store",
      headers:{"user-agent":"Mozilla/5.0","content-type":"application/x-www-form-urlencoded","cookie":cookie},
      body:new URLSearchParams(fields).toString(),
    });
    const body = await r.text();
    results.push({ eventArgument, status:r.status, location:r.headers.get("location"), length:body.length, hasBid:body.includes("26-04-36"), title:body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g," ").trim() || null, bodyStart:body.slice(0,300) });
  }
  return NextResponse.json({ fieldCount:Object.keys(baseFields).length, cookie:!!cookie, results });
}
