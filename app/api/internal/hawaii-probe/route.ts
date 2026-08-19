import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const API = "https://hands.ehawaii.gov/hands/api/bidding-opportunities";
const CRITERIA = {
  query: "",
  showClosed: false,
  showCancelled: false,
  omitPagination: false,
  categories: [],
  procurementCategory: "",
  department: "",
  islands: [],
  statuses: ["POSTED"],
  publishDate: "",
  offerDueDate: "",
  jurisdiction: "",
};

export async function GET() {
  const response = await fetch(`${API}?size=100&page=0&sort=publish_date_dt,desc`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    body: JSON.stringify(CRITERIA),
    cache: "no-store",
  });
  const text = await response.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch {}
  const result = parsed?.data?.searchResult;
  const rows = Array.isArray(result?.content) ? result.content : [];
  return NextResponse.json({
    ok: response.ok,
    status: response.status,
    topKeys: parsed ? Object.keys(parsed) : [],
    dataKeys: parsed?.data ? Object.keys(parsed.data) : [],
    total: parsed?.data?.total ?? null,
    totalElements: result?.totalElements ?? null,
    totalPages: result?.totalPages ?? null,
    number: result?.number ?? null,
    size: result?.size ?? null,
    availableSystems: parsed?.data?.availableSystems ?? null,
    statuses: parsed?.data?.statuses ?? null,
    jurisdictions: parsed?.data?.jurisdictions ?? null,
    sample: rows.slice(0, 10),
    rowKeys: rows[0] ? Object.keys(rows[0]) : [],
    raw: parsed ? undefined : text.slice(0, 5000),
  });
}
