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
  const getUrl = grid.attr("data-get-url") || GRID;

  const requestBody = {
    base64SecureConfiguration: secure,
    sortExpression: "",
    search: null,
    page: 1,
    pageSize: 25,
    pcfFilter: "",
    timezoneOffset: 300,
    entityName,
    entityId: null,
  };

  let gridResult: Record<string, unknown> = { attempted: false };
  if (token && secure && entityName) {
    const response = await fetch(new URL(getUrl, ROOT), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        "user-agent": USER_AGENT,
        referer: PAGE,
        __RequestVerificationToken: token,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
      redirect: "follow",
    });
    const responseText = await response.text();
    let parsed: any = null;
    try { parsed = JSON.parse(responseText); } catch {}
    gridResult = {
      attempted: true,
      status: response.status,
      type: response.headers.get("content-type"),
      length: responseText.length,
      keys: parsed && typeof parsed === "object" ? Object.keys(parsed) : [],
      itemCount: parsed?.ItemCount ?? parsed?.itemCount ?? parsed?.TotalRecordCount ?? parsed?.totalRecordCount ?? null,
      pageNumber: parsed?.PageNumber ?? parsed?.pageNumber ?? null,
      pageCount: parsed?.PageCount ?? parsed?.pageCount ?? null,
      sample: parsed ? JSON.stringify(parsed).slice(0, 6000) : responseText.slice(0, 3000),
    };
  }

  return NextResponse.json({
    pageStatus: page.status,
    tokenStatus: tokenResponse.status,
    tokenFound: Boolean(token),
    tokenLength: token.length,
    grid: {
      selectedView,
      attrKeys: Object.keys((grid.get(0) as any)?.attribs || {}),
      layoutsRawLength: layoutsRaw.length,
      layoutsRawPrefix: layoutsRaw.slice(0, 2000),
      layoutType: layouts === null ? "null" : Array.isArray(layouts) ? "array" : typeof layouts,
      layoutCount: layoutList.length,
      activeViewId: active?.Id || null,
      secureConfigFound: Boolean(secure),
      secureConfigLength: secure.length,
      entityName: entityName || null,
      getUrl,
    },
    gridResult,
  });
}
