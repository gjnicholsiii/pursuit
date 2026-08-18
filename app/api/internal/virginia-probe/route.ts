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
  const cookie = cookies(page);
  const script = await fetch(`${SCRIPT}?_=${Date.now()}`, {
    headers: { accept: "application/javascript,text/javascript,*/*;q=0.8", "user-agent": UA, referer: PAGE, ...(cookie ? { cookie } : {}) },
    cache: "no-store",
  });
  const js = await script.text();
  const needles = ["getAllOpportunities", "retreiveAllOpportunitiesResponse", "opportunityList", "recentlyPosted", "pastYear", "ajax", "webpack", "<!doctype", "<html"];
  const hits = Object.fromEntries(needles.map(needle => [needle, js.indexOf(needle)]));
  const interesting: Record<string,string> = {};
  for (const [needle, pos] of Object.entries(hits)) {
    if (typeof pos === "number" && pos >= 0) interesting[needle] = js.slice(Math.max(0, pos - 1000), Math.min(js.length, pos + 2500));
  }
  return NextResponse.json({
    pageStatus: page.status,
    pageContentType: page.headers.get("content-type"),
    scriptStatus: script.status,
    scriptContentType: script.headers.get("content-type"),
    scriptContentEncoding: script.headers.get("content-encoding"),
    scriptLength: js.length,
    hits,
    first2000: js.slice(0, 2000),
    last1000: js.slice(-1000),
    interesting,
  });
}
