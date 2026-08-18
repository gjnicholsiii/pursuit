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
  return (values.length ? values : fallback ? [fallback] : []).map(v => v.split(";", 1)[0]).filter(Boolean);
}

function mergeCookies(...sets: string[][]) {
  const map = new Map<string, string>();
  for (const set of sets) for (const pair of set) {
    const eq = pair.indexOf("=");
    if (eq > 0) map.set(pair.slice(0, eq), pair);
  }
  return [...map.values()];
}

function extractToken(html: string) {
  const $ = load(html);
  const value = $("input[name='__RequestVerificationToken']").attr("value") || $("input[id='__RequestVerificationToken']").attr("value");
  if (value) return value.trim();
  const match = html.match(/value=["']([^"']+)["'][^>]*(?:name|id)=["']__RequestVerificationToken["']|(?:name|id)=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)/i);
  return (match?.[1] || match?.[2] || "").trim();
}

function decodeLayouts(value: string) {
  for (const candidate of [value, (() => { try { return decodeURIComponent(value); } catch { return ""; } })()]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch {}
    try { return JSON.parse(Buffer.from(candidate, "base64").toString("utf8")); } catch {}
  }
  return null;
}

async function attempt(label: string, token: string, secure: string, cookies: string[], extraBody: Record<string, unknown> = {}) {
  const response = await fetch(GRID, {
    method: "POST",
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/json; charset=UTF-8",
      "user-agent": USER_AGENT,
      referer: PAGE,
      "x-requested-with": "XMLHttpRequest",
      __RequestVerificationToken: token,
      ...(cookies.length ? { cookie: cookies.join("; ") } : {}),
    },
    body: JSON.stringify({
      base64SecureConfiguration: secure,
      sortExpression: "",
      search: null,
      filter: null,
      metaFilter: null,
      page: 1,
      pageSize: 10,
      timezoneOffset: 240,
      pcfFilter: "",
      ...extraBody,
    }),
    cache: "no-store",
  });
  const text = await response.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch {}
  return {
    label,
    status: response.status,
    contentType: response.headers.get("content-type"),
    itemCount: parsed?.ItemCount ?? parsed?.itemCount ?? null,
    pageCount: parsed?.PageCount ?? parsed?.pageCount ?? null,
    records: Array.isArray(parsed?.Records) ? parsed.Records.length : null,
    keys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 20) : [],
    excerpt: text.slice(0, 700),
  };
}

export async function GET() {
  const pageResponse = await fetch(PAGE, { headers: { accept: "text/html", "user-agent": USER_AGENT }, redirect: "follow", cache: "no-store" });
  const pageHtml = await pageResponse.text();
  const pageCookies = cookiePairs(pageResponse);

  const tokenResponse = await fetch(TOKEN, {
    headers: { accept: "text/html,*/*", "user-agent": USER_AGENT, referer: PAGE, ...(pageCookies.length ? { cookie: pageCookies.join("; ") } : {}) },
    redirect: "follow",
    cache: "no-store",
  });
  const tokenHtml = await tokenResponse.text();
  const token = extractToken(tokenHtml);
  const cookies = mergeCookies(pageCookies, cookiePairs(tokenResponse));

  const $ = load(pageHtml);
  const grid = $(".entity-grid").first();
  const selectedView = grid.attr("data-selected-view") || "";
  const layouts = decodeLayouts(grid.attr("data-view-layouts") || "");
  const list = Array.isArray(layouts) ? layouts : [];
  const active = list.find((entry: any) => String(entry?.Id || "").toLowerCase() === selectedView.toLowerCase()) || list[0] || null;
  const secure = active?.Base64SecureConfiguration || "";

  const attempts = [];
  if (token && secure) {
    attempts.push(await attempt("header-token", token, secure, cookies));
    attempts.push(await attempt("header-plus-body-token", token, secure, cookies, { __RequestVerificationToken: token }));
  }

  return NextResponse.json({
    pageStatus: pageResponse.status,
    tokenStatus: tokenResponse.status,
    tokenFound: Boolean(token),
    tokenLength: token.length,
    cookieCount: cookies.length,
    selectedView,
    layoutCount: list.length,
    secureFound: Boolean(secure),
    secureLength: secure.length,
    activeKeys: active ? Object.keys(active) : [],
    attempts,
  });
}
