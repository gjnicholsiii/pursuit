import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ROOT = "https://evp.nc.gov";
const PAGE = `${ROOT}/solicitations/?status=0`;
const LIST_ID = "863ea987-6d3e-ed11-9daf-001dd805ec0b";
const VIEW_ID = "662288b0-eba7-ed11-aad1-001dd807215d";
const GRID = `${ROOT}/_services/entity-grid-data.json/${LIST_ID}`;
const EXPORT = `${ROOT}/_services/download-as-excel/${LIST_ID}`;

function cookiesFrom(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(v => v.split(";", 1)[0]);
}

async function summarize(response: Response) {
  const type = response.headers.get("content-type") || "";
  const buffer = Buffer.from(await response.arrayBuffer());
  const prefix = buffer.subarray(0, 3000).toString("utf8").replace(/\s+/g, " ");
  return {
    status: response.status,
    type,
    length: buffer.length,
    prefix: prefix.slice(0, 2500),
    disposition: response.headers.get("content-disposition"),
  };
}

export async function GET() {
  const page = await fetch(PAGE, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    redirect: "follow",
    cache: "no-store",
  });
  const html = await page.text();
  const $ = load(html);
  const pageCookies = cookiesFrom(page);
  const cookie = pageCookies.join("; ");
  const common = {
    "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    ...(cookie ? { cookie } : {}),
    referer: PAGE,
  };

  const tests: Record<string, unknown> = {};

  const apiUrls = [
    `${ROOT}/_api/evp_solicitations?$top=2`,
    `${ROOT}/_api/evp_solicitations?$select=evp_solicitationid&$top=2`,
  ];
  for (const [index, url] of apiUrls.entries()) {
    try {
      tests[`api${index + 1}`] = await summarize(await fetch(url, {
        headers: { ...common, accept: "application/json" },
        cache: "no-store",
      }));
    } catch (error) {
      tests[`api${index + 1}`] = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  const exportTests: Array<[string, RequestInit]> = [
    ["exportGet", { method: "GET", headers: { ...common, accept: "*/*" } }],
    ["exportPostEmpty", { method: "POST", headers: { ...common, accept: "*/*", "content-type": "application/x-www-form-urlencoded" }, body: "" }],
    ["exportPostView", { method: "POST", headers: { ...common, accept: "*/*", "content-type": "application/x-www-form-urlencoded" }, body: `viewid=${encodeURIComponent(VIEW_ID)}` }],
  ];
  for (const [name, init] of exportTests) {
    try { tests[name] = await summarize(await fetch(EXPORT, { ...init, cache: "no-store", redirect: "follow" })); }
    catch (error) { tests[name] = { error: error instanceof Error ? error.message : String(error) }; }
  }

  const gridBodies: Array<[string, unknown]> = [
    ["gridEmpty", {}],
    ["gridPage", { page: 1 }],
    ["gridViewPage", { viewId: VIEW_ID, page: 1 }],
    ["gridSelectedView", { selectedView: VIEW_ID, page: 1, pageSize: 10 }],
    ["gridView", { view: VIEW_ID, page: 1, pageSize: 10, search: "", sort: "", filter: "" }],
  ];
  for (const [name, body] of gridBodies) {
    try {
      tests[name] = await summarize(await fetch(GRID, {
        method: "POST",
        headers: { ...common, accept: "application/json", "content-type": "application/json; charset=UTF-8" },
        body: JSON.stringify(body),
        cache: "no-store",
      }));
    } catch (error) {
      tests[name] = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  const grid = $(".entity-grid").first();
  return NextResponse.json({
    pageStatus: page.status,
    cookieNames: pageCookies.map(v => v.split("=")[0]),
    grid: {
      getUrl: grid.attr("data-get-url") || null,
      selectedView: grid.attr("data-selected-view") || null,
      layoutLength: (grid.attr("data-view-layouts") || "").length,
    },
    tests,
  });
}
