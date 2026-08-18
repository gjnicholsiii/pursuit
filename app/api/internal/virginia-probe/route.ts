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
  const cookie = cookies(page);
  const scriptUrl = new URL("AllOpportunitiesapp.js", page.url).toString();
  const response = await fetch(`${scriptUrl}?_=${Date.now()}`, {
    headers: { accept: "application/javascript,text/javascript,*/*;q=0.8", "user-agent": UA, referer: page.url, ...(cookie ? { cookie } : {}) },
    cache: "no-store",
  });
  const body = await response.text();
  const needles = ["solrconnect.jsp", "searchUrl", "cursorMark", "resultsPerPage", "Opportunity Created Date", "Advertise Detail Url", "OrgName_s", "SmallBusSetAside", "Description"];
  const snippets: Record<string,string[]> = {};
  for (const needle of needles) {
    const values:string[]=[]; let pos=0;
    while ((pos=body.indexOf(needle,pos))>=0 && values.length<8) {
      values.push(body.slice(Math.max(0,pos-2200),Math.min(body.length,pos+4200)));
      pos+=needle.length;
    }
    snippets[needle]=values;
  }
  const requestLike = [...body.matchAll(/[\s\S]{0,600}(?:fetch\(|XMLHttpRequest|\.ajax\(|axios|searchUrl|solrconnect\.jsp)[\s\S]{0,1400}/gi)].slice(0,20).map(m=>m[0]);
  return NextResponse.json({ pageStatus:page.status, scriptStatus:response.status, length:body.length, snippets, requestLike });
}
