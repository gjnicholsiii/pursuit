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

async function query(params: Record<string,string>, cookie: string) {
  const url = new URL(SOLR);
  for (const [key,value] of Object.entries(params)) url.searchParams.append(key,value);
  const r = await fetch(url, { headers: { accept: "application/json,text/plain,*/*", "user-agent": UA, referer: PAGE, ...(cookie ? { cookie } : {}) }, cache: "no-store" });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return {
    status: r.status,
    numFound: json?.response?.numFound ?? null,
    docs: Array.isArray(json?.response?.docs) ? json.response.docs : [],
    facets: json?.facet_counts?.facet_fields ?? null,
    error: json?.error ?? (json ? null : text.slice(0,1000)),
  };
}

export async function GET() {
  const page = await fetch(PAGE, { headers: { accept: "text/html", "user-agent": UA, referer: "https://eva.virginia.gov/" }, redirect: "follow", cache: "no-store" });
  const cookie = cookies(page);
  const statusFacets = await query({ q:"*:*", rows:"0", facet:"on", "facet.field":"status", "facet.limit":"100", "facet.mincount":"1", wt:"json" }, cookie);
  const open = await query({ q:"*:*", fq:'status:"Open"', rows:"5", start:"0", sort:"closedate asc,id asc", facet:"off", wt:"json" }, cookie);
  const future = await query({ q:"*:*", fq:"closedate:[NOW TO *]", rows:"5", start:"0", sort:"closedate asc,id asc", facet:"on", "facet.field":"status", "facet.limit":"100", "facet.mincount":"1", wt:"json" }, cookie);
  const openFuture = await query({ q:"*:*", fq:'status:"Open"', fq2:"closedate:[NOW TO *]", rows:"0", facet:"off", wt:"json" }, cookie);
  return NextResponse.json({ pageStatus:page.status, cookie:!!cookie, statusFacets, open, future, openFuture });
}
