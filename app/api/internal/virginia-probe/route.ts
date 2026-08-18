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
  const script = await fetch(SCRIPT, {
    headers: { accept: "application/javascript,text/javascript,*/*;q=0.8", "user-agent": UA, referer: PAGE, ...(cookie ? { cookie } : {}) },
    cache: "no-store",
  });
  const js = await script.text();
  const urls = [...js.matchAll(/(?:url\s*:\s*|fetch\s*\(|ajax\s*\()["'`]([^"'`]+)["'`]/gi)].map(m => m[1]);
  const serviceLines = js.split("\n").filter(line => /ajax|url|opportun|search|json|servlet|controller|\.do|\.jsp/i.test(line)).slice(0, 250);
  return NextResponse.json({
    pageStatus: page.status,
    scriptStatus: script.status,
    scriptLength: js.length,
    urls: [...new Set(urls)],
    serviceLines,
    script: js.slice(0, 60000),
  });
}
