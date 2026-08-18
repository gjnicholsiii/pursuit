import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROOT = "https://mvendor.cgieva.com/Vendor";
const PAGE = `${ROOT}/public/AllOpportunities.jsp`;
const API = `${ROOT}/public/getAllOpportunities`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function cookies(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(v => v.split(";", 1)[0]).join("; ");
}

async function request(dateRange: string, cookie: string) {
  const params = new URLSearchParams({
    searchText: "",
    zoneId: "",
    organizationId: "",
    categoryId: "",
    sortBy: "recentlyPosted",
    endDate: "",
    dateRange,
    startDate: "",
    _: String(Date.now()),
  });
  const response = await fetch(`${API}?${params.toString()}`, {
    headers: {
      accept: "application/json,text/plain,*/*",
      "x-requested-with": "XMLHttpRequest",
      "user-agent": UA,
      referer: PAGE,
      ...(cookie ? { cookie } : {}),
    },
    cache: "no-store",
  });
  const body = await response.text();
  let parsed: any = null;
  try { parsed = JSON.parse(body); } catch {}
  const envelope = parsed?.retreiveAllOpportunitiesResponse ?? null;
  const list = Array.isArray(envelope?.opportunityList) ? envelope.opportunityList : [];
  return {
    status: response.status,
    bodyLength: body.length,
    topLevelKeys: parsed && typeof parsed === "object" ? Object.keys(parsed) : [],
    errorSection: envelope?.errorSection ?? null,
    noOfItems: envelope?.noOfItems ?? null,
    opportunityListLength: list.length,
    firstThree: list.slice(0, 3),
    lastOne: list.slice(-1),
    bodyPreview: parsed ? undefined : body.slice(0, 5000),
  };
}

export async function GET() {
  const page = await fetch(PAGE, {
    headers: { accept: "text/html", "user-agent": UA, referer: "https://eva.virginia.gov/" },
    redirect: "follow",
    cache: "no-store",
  });
  const cookie = cookies(page);
  const [blank, pastYear] = await Promise.all([
    request("", cookie),
    request("pastYear", cookie),
  ]);
  return NextResponse.json({ pageStatus: page.status, blank, pastYear });
}
