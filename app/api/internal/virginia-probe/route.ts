import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const PAGE = "https://mvendor.cgieva.com/Vendor/public/AllOpportunities.jsp";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function cookies(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(v => v.split(";", 1)[0]).join("; ");
}

export async function GET() {
  const page = await fetch(PAGE, { headers: { accept: "text/html", "user-agent": UA, referer: "https://eva.virginia.gov/" }, redirect: "follow", cache: "no-store" });
  const html = await page.text();
  const cookie = cookies(page);
  const rawScripts = [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
  const urls = [...new Set(rawScripts.map(src => new URL(src, page.url).toString()))];
  const needles = ["getAllOpportunities", "retreiveAllOpportunitiesResponse", "opportunityList", "recentlyPosted", "pastYear", "searchText", "zoneSelected", "AllOpportunities"];
  const scans = [];
  for (const url of urls) {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`, {
      headers: { accept: "application/javascript,text/javascript,*/*;q=0.8", "user-agent": UA, referer: page.url, ...(cookie ? { cookie } : {}) },
      cache: "no-store",
    });
    const body = await response.text();
    const hits = Object.fromEntries(needles.map(needle => [needle, body.indexOf(needle)]));
    const snippets: Record<string,string> = {};
    for (const [needle, pos] of Object.entries(hits)) if (typeof pos === "number" && pos >= 0) snippets[needle] = body.slice(Math.max(0, pos - 1500), Math.min(body.length, pos + 3500));
    scans.push({ url, status: response.status, contentType: response.headers.get("content-type"), length: body.length, hits, snippets });
  }
  return NextResponse.json({ pageStatus: page.status, scriptCount: scans.length, scans });
}
