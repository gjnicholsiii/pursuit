import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const urls = [
  "https://vtbuys.suppliers.vermont.gov/",
  "https://vtbuys.suppliers.vermont.gov/page.aspx/en/usr/login?ReturnUrl=%2fpage.aspx%2fen%2fbuy%2fhomepage",
  "https://vtbuys.suppliers.vermont.gov/page.aspx/en/rfp/request_browse_public",
  "https://vtbuys.suppliers.vermont.gov/page.aspx/en/buy/homepage",
  "https://vtbuys.suppliers.vermont.gov/page.aspx/en/buy/public_bids",
];

async function inspect(url: string) {
  try {
    const r = await fetch(url, { redirect: "follow", cache: "no-store", headers: { accept: "text/html,application/xhtml+xml,application/json", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
    const text = await r.text();
    return { url, status:r.status, finalUrl:r.url, contentType:r.headers.get("content-type"), length:text.length, title:text.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim() || null, sample:text.slice(0,10000) };
  } catch (error) {
    return { url, error:error instanceof Error ? error.message : String(error) };
  }
}

export async function GET() {
  return NextResponse.json({ results: await Promise.all(urls.map(inspect)) });
}
