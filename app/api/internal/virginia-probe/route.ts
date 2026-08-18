import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROOT = "https://mvendor.cgieva.com/Vendor";
const PAGE = `${ROOT}/public/AllOpportunities.jsp`;
const SCRIPT = `${ROOT}/public/AllOpportunitiesapp.js`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function cookies(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(v => v.split(";", 1)[0]).join("; ");
}

export async function GET() {
  const page = await fetch(PAGE, {
    headers: { accept: "text/html", "user-agent": UA, referer: "https://eva.virginia.gov/" },
    redirect: "follow",
    cache: "no-store",
  });
  const pageHtml = await page.text();
  const cookie = cookies(page);
  const script = await fetch(SCRIPT, {
    headers: { accept: "application/javascript,text/javascript,*/*;q=0.8", "user-agent": UA, referer: PAGE, ...(cookie ? { cookie } : {}) },
    cache: "no-store",
  });
  const js = await script.text();
  const needle = "getAllOpportunities";
  const snippets: string[] = [];
  let pos = 0;
  while ((pos = js.indexOf(needle, pos)) >= 0 && snippets.length < 20) {
    snippets.push(js.slice(Math.max(0, pos - 1200), Math.min(js.length, pos + 2200)));
    pos += needle.length;
  }
  const baseTags = [...pageHtml.matchAll(/<base\b[^>]*>/gi)].map(m => m[0]);
  const scripts = [...pageHtml.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
  return NextResponse.json({
    pageStatus: page.status,
    pageUrl: page.url,
    baseTags,
    scriptStatus: script.status,
    scriptUrl: script.url,
    scriptLength: js.length,
    scripts,
    occurrences: snippets.length,
    snippets,
  });
}
