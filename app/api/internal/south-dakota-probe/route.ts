import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const urls = [
  "https://www.sd.gov/api/now/table/kb_knowledge?sysparm_query=number%3DKB0044739&sysparm_fields=number%2Cshort_description%2Ctext%2Csys_id&sysparm_limit=1",
  "https://www.sd.gov/api/now/sp/page?id=kb_article_view&sysparm_article=KB0044739",
  "https://www.sd.gov/bhra/api/now/table/kb_knowledge?sysparm_query=number%3DKB0044739&sysparm_fields=number%2Cshort_description%2Ctext%2Csys_id&sysparm_limit=1",
];

export async function GET() {
  const results = [];
  for (const url of urls) {
    try {
      const r = await fetch(url, { redirect: "follow", cache: "no-store", headers: { accept: "application/json,text/plain,*/*", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
      const text = await r.text();
      results.push({ url, status:r.status, finalUrl:r.url, contentType:r.headers.get("content-type"), length:text.length, sample:text.slice(0,12000) });
    } catch (error) {
      results.push({ url, error:error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ results });
}
