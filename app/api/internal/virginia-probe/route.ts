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
  const page = await fetch(PAGE, {
    headers: { accept: "text/html", "user-agent": UA, referer: "https://eva.virginia.gov/" },
    redirect: "follow",
    cache: "no-store",
  });
  const cookie = cookies(page);
  const bridge = new URL("solrconnect.jsp", page.url);
  bridge.search = new URLSearchParams({
    q: "*: *".replace(" ", ""),
    rows: "3",
    wt: "json",
    facet: "off",
  }).toString();
  const response = await fetch(bridge, {
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent": UA,
      referer: page.url,
      ...(cookie ? { cookie } : {}),
    },
    cache: "no-store",
  });
  const raw = await response.text();
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch {}
  return NextResponse.json({
    pageStatus: page.status,
    bridgeUrl: bridge.toString(),
    bridgeStatus: response.status,
    bridgeContentType: response.headers.get("content-type"),
    rawLength: raw.length,
    responseHeader: parsed?.responseHeader ?? null,
    numFound: parsed?.response?.numFound ?? null,
    docs: Array.isArray(parsed?.response?.docs) ? parsed.response.docs : null,
    topLevelKeys: parsed && typeof parsed === "object" ? Object.keys(parsed) : [],
    rawPreview: parsed ? undefined : raw.slice(0, 5000),
  });
}
