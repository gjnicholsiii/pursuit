import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const URL = "https://mvendor.cgieva.com/Vendor/public/AllOpportunities.jsp";

export async function GET() {
  const response = await fetch(URL, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
      referer: "https://eva.virginia.gov/",
    },
    redirect: "manual",
    cache: "no-store",
  });
  const body = await response.text();
  return NextResponse.json({
    status: response.status,
    location: response.headers.get("location"),
    contentType: response.headers.get("content-type"),
    setCookie: response.headers.get("set-cookie"),
    bodyLength: body.length,
    body: body.slice(0, 25000),
  });
}
