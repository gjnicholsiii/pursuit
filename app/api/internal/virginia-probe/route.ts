import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const ROOT = "https://mvendor.cgieva.com/Vendor/public/";
const PAGE = `${ROOT}AllOpportunities.jsp`;
const SOLR = `${ROOT}solrconnect.jsp`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function cookies(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(v => v.split(";", 1)[0]).join("; ");
}

async function query(q: string, rows: number, cookie: string) {
  const url = new URL(SOLR);
  url.searchParams.set("q", q);
  url.searchParams.set("rows", String(rows));
  url.searchParams.set("start", "0");
  url.searchParams.set("facet", "off");
  url.searchParams.set("wt", "json");
  const r = await fetch(url, { headers: { accept: "application/json,text/plain,*/*", "user-agent": UA, referer: PAGE, ...(cookie ? { cookie } : {}) }, cache: "no-store" });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status:r.status, numFound:json?.response?.numFound ?? null, docs:Array.isArray(json?.response?.docs)?json.response.docs:[], error:json?.error ?? (json?null:text.slice(0,1000)) };
}

export async function GET() {
  const page = await fetch(PAGE, { headers: { accept: "text/html", "user-agent": UA, referer: "https://eva.virginia.gov/" }, redirect: "follow", cache: "no-store" });
  const cookie = cookies(page);
  const open = await query("status:Open", 10, cookie);
  const future = await query("closedate:[NOW TO *]", 10, cookie);
  const openAndFuture = await query("status:Open AND closedate:[NOW TO *]", 10, cookie);
  const openPastDue = await query("status:Open AND closedate:[* TO NOW]", 10, cookie);
  return NextResponse.json({ pageStatus:page.status, cookie:!!cookie, open, future, openAndFuture, openPastDue });
}
