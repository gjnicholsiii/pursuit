import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const BASE = "https://vendor.myfloridamarketplace.com";
const criteria = {
  pageSize: 25,
  type: [],
  status: [],
  agency: [],
  adNumber: "",
  agencyAdvertisementNumber: "",
  title: "",
  publishedDate: "",
  openDate: "",
  endDate: "",
  commodityCodes: [],
  intendsToParticipate: "",
  assignee: "",
};

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      accept: "application/json,text/plain,*/*",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const body = await response.text();
  return {
    path,
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get("content-type"),
    body: body.slice(0, 30000),
  };
}

export async function GET() {
  const results = [];
  for (const path of ["/pub/search/newsfeed", "/pub/search/picklistOrg", "/bids/AdTypes", "/bids/AdStatuses"]) {
    try { results.push(await request(path)); }
    catch (error) { results.push({ path, error: error instanceof Error ? error.message : String(error) }); }
  }
  for (const [path, body] of [
    ["/pub/search/bids/count", criteria],
    ["/pub/search/bids", { ...criteria, page: 1 }],
  ] as const) {
    try { results.push(await request(path, { method: "POST", body: JSON.stringify(body) })); }
    catch (error) { results.push({ path, error: error instanceof Error ? error.message : String(error) }); }
  }
  return NextResponse.json({ ok: true, results });
}
