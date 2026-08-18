import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const ROOT = "https://evp.nc.gov";
const PAGE = `${ROOT}/solicitations/?status=0`;
const TOKEN = `${ROOT}/_layout/tokenhtml`;
const LIST_ID = "863ea987-6d3e-ed11-9daf-001dd805ec0b";
const GRID = `${ROOT}/_services/entity-grid-data.json/${LIST_ID}`;
const USER_AGENT = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

function cookiePairs(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(value => value.split(";", 1)[0]).filter(Boolean);
}

function mergeCookies(...sets: string[][]) {
  const map = new Map<string, string>();
  for (const set of sets) {
    for (const pair of set) {
      const eq = pair.indexOf("=");
      if (eq > 0) map.set(pair.slice(0, eq), pair);
    }
  }
  return [...map.values()];
}

function extractToken(html: string) {
  const $ = load(html);
  const direct = $("input[name='__RequestVerificationToken']").attr("value") || $("input[id='__RequestVerificationToken']").attr("value");
  if (direct) return direct.trim();
  const match = html.match(/(?:__RequestVerificationToken[^>]*value=["']([^"']+)|value=["']([^"']+)["'][^>]*__RequestVerificationToken)/i);
  if (match) return (match[1] || match[2] || "").trim();
  const stripped = $.root().text().trim();
  return stripped && stripped.length < 2000 ? stripped : "";
}

function decodeLayout(value: string) {
  const candidates = [value];
  try { candidates.push(decodeURIComponent(value)); } catch {}
  candidates.push(value.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, "&"));
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch {}
    try {
      const decoded = Buffer.from(candidate, "base64").toString("utf8");
      return JSON.parse(decoded);
    } catch {}
  }
  return null;
}

async function postGrid(url: string, token: string, cookie: string, body: Record<string, unknown>) {
  const response = await fetch(new URL(url, ROOT), {
    method: "POST",
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/json; charset=UTF-8",
      "user-agent": USER_AGENT,
      referer: PAGE,
      "x-requested-with": "XMLHttpRequest",
      __RequestVerificationToken: token,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "follow",
  });
  const responseText = await response.text();
  let parsed: any = null;
  try { parsed = JSON.parse(responseText); } catch {}
  const bodyText = load(responseText)("body").text().replace(/\s+/g, " ").trim();
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    length: responseText.length,
    keys: parsed && typeof parsed === "object" ? Object.keys(parsed) : [],
    itemCount: parsed?.ItemCount ?? parsed?.itemCount ?? parsed?.TotalRecordCount ?? parsed?.totalRecordCount ?? null,
    pageNumber: parsed?.PageNumber ?? parsed?.pageNumber ?? null,
    pageCount: parsed?.PageCount ?? parsed?.pageCount ?? null,
    bodyText: bodyText.slice(0, 1200),
    sample: parsed ? JSON.stringify(parsed).slice(0, 3500) : "",
  };
}

export async function GET() {
  const page = await fetch(PAGE, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT },
    redirect: "follow",
    cache: "no-store",
  });
  const pageHtml = await page.text();
  const pageCookies = cookiePairs(page);
  const pageCookie = pageCookies.join("; ");

  const tokenResponse = await fetch(TOKEN, {
    headers: {
      accept: "text/html,*/*",
      "user-agent": USER_AGENT,
      referer: PAGE,
      ...(pageCookie ? { cookie: pageCookie } : {}),
    },
    redirect: "follow",
    cache: "no-store",
  });
  const tokenHtml = await tokenResponse.text();
  const allCookies = mergeCookies(pageCookies, cookiePairs(tokenResponse));
  const cookie = allCookies.join("; ");
  const token = extractToken(tokenHtml);

  const $ = load(pageHtml);
  const grid = $(".entity-grid").first();
  const selectedView = grid.attr("data-selected-view") || "";
  const layoutsRaw = grid.attr("data-view-layouts") || "";
  const layouts = decodeLayout(layoutsRaw);
  const layoutList = Array.isArray(layouts) ? layouts : [];
  const active = layoutList.find((entry: any) => String(entry?.Id || "").toLowerCase() === selectedView.toLowerCase()) || layoutList[0] || null;
  const secure = active?.Base64SecureConfiguration || "";
  const entityName = active?.Configuration?.EntityName || "";
  const pageSize = Number(active?.Configuration?.PageSize || 10) || 10;
  const getUrl = grid.attr("data-get-url") || GRID;

  const base = {
    base64SecureConfiguration: secure,
    sortExpression: "",
    search: null,
    page: 1,
    pageSize,
    pcfFilter: "",
    timezoneOffset: 240,
    entityName,
  };

  const variants: Array<[string, Record<string, unknown>]> = [
    ["exact", base],
    ["withNullEntityId", { ...base, entityId: null }],
    ["zeroTimezone", { ...base, timezoneOffset: 0 }],
    ["emptySearch", { ...base, search: "" }],
    ["omitSearch", Object.fromEntries(Object.entries(base).filter(([key]) => key !== "search"))],
    ["omitFilter", Object.fromEntries(Object.entries(base).filter(([key]) => key !== "pcfFilter"))],
    ["pageMinusOne", { ...base, pageSize: -1 }],
  ];

  const tests: Record<string, unknown> = {};
  if (token && secure && entityName) {
    for (const [name, body] of variants) tests[name] = await postGrid(getUrl, token, cookie, body);
  }

  return NextResponse.json({
    pageStatus: page.status,
    tokenStatus: tokenResponse.status,
    tokenFound: Boolean(token),
    grid: {
      selectedView,
      layoutCount: layoutList.length,
      pageSize,
      secureConfigFound: Boolean(secure),
      entityName: entityName || null,
      getUrl,
    },
    tests,
  });
}
