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
  const scriptUrl = new URL("AllOpportunitiesapp.js", page.url).toString();
  const response = await fetch(`${scriptUrl}?_=${Date.now()}`, {
    headers: { accept: "application/javascript,text/javascript,*/*;q=0.8", "user-agent": UA, referer: page.url, ...(cookie ? { cookie } : {}) },
    cache: "no-store",
  });
  const body = await response.text();
  const strings = [...body.matchAll(/["']([^"'\\]{2,300})["']/g)].map(m => m[1]);
  const endpointStrings = [...new Set(strings.filter(s => /(?:\.jsp|ajax|opportun|solicit|search|bid|quickquote|rfp|public\/)/i.test(s)))].slice(0, 500);
  const jspRefs = [...new Set(body.match(/[A-Za-z0-9_./?=&%-]+\.jsp(?:\?[A-Za-z0-9_./?=&%+-]*)?/gi) ?? [])].slice(0, 300);
  const urlRefs = [...new Set(body.match(/https?:\\?\/\\?\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gi) ?? [])].slice(0, 100);
  return NextResponse.json({ pageStatus: page.status, scriptStatus: response.status, length: body.length, jspRefs, urlRefs, endpointStrings });
}
