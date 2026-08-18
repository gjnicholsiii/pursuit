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
  for (const set of sets) for (const pair of set) {
    const eq = pair.indexOf("=");
    if (eq > 0) map.set(pair.slice(0, eq), pair);
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
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch {}
    try { return JSON.parse(Buffer.from(candidate, "base64").toString("utf8")); } catch {}
  }
  return null;
}

function conciseRecord(record: any) {
  const attrs = Array.isArray(record?.Attributes) ? record.Attributes : [];
  return {
    id: record?.Id || null,
    fields: Object.fromEntries(attrs.map((attr: any) => [attr?.Name, attr?.DisplayValue ?? attr?.FormattedValue ?? attr?.Value ?? null])),
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
  const tokenResponse = await fetch(TOKEN, {
    headers: {
      accept: "text/html,*/*",
      "user-agent": USER_AGENT,
      referer: PAGE,
      ...(pageCookies.length ? { cookie: pageCookies.join("; ") } : {}),
    },
    redirect: "follow",
    cache: "no-store",
  });
  const tokenHtml = await tokenResponse.text();
  const allCookies = mergeCookies(pageCookies, cookiePairs(tokenResponse));
  const token = extractToken(tokenHtml);

  const $ = load(pageHtml);
  const grid = $(".entity-grid").first();
  const selectedView = grid.attr("data-selected-view") || "";
  const layouts = decodeLayout(grid.attr("data-view-layouts") || "");
  const layoutList = Array.isArray(layouts) ? layouts : [];
  const active = layoutList.find((entry: any) => String(entry?.Id || "").toLowerCase() === selectedView.toLowerCase()) || layoutList[0] || null;
  const secure = active?.Base64SecureConfiguration || "";
  const entityName = active?.Configuration?.EntityName || "";
  const pageSize = Number(active?.Configuration?.PageSize || 10) || 10;
  const getUrl = grid.attr("data-get-url") || GRID;

  const filters = $(".entitylist-filter-option-group").toArray().map(group => {
    const el = $(group);
    const label = el.find(".entitylist-filter-option-group-label").first();
    return {
      label: label.text().replace(/\s+/g, " ").trim(),
      filterId: label.attr("data-filter-id") || null,
      html: $.html(group).slice(0, 12000),
      inputs: el.find("input,select,option").toArray().map(input => ({
        tag: input.tagName,
        type: $(input).attr("type") || null,
        name: $(input).attr("name") || null,
        value: $(input).attr("value") || null,
        checked: $(input).is(":checked"),
        selected: $(input).is(":selected"),
        text: $(input).text().replace(/\s+/g, " ").trim(),
      })),
    };
  });

  let gridSummary: Record<string, unknown> = {};
  if (token && secure && entityName) {
    const response = await fetch(new URL(getUrl, ROOT), {
      method: "POST",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/json; charset=UTF-8",
        "user-agent": USER_AGENT,
        referer: PAGE,
        "x-requested-with": "XMLHttpRequest",
        __RequestVerificationToken: token,
        ...(allCookies.length ? { cookie: allCookies.join("; ") } : {}),
      },
      body: JSON.stringify({
        base64SecureConfiguration: secure,
        sortExpression: "",
        search: null,
        page: 1,
        pageSize,
        pcfFilter: "",
        timezoneOffset: 240,
        entityName,
      }),
      cache: "no-store",
    });
    const parsed = await response.json();
    gridSummary = {
      status: response.status,
      itemCount: parsed?.ItemCount ?? null,
      pageCount: parsed?.PageCount ?? null,
      pageSize: parsed?.PageSize ?? null,
      samples: (parsed?.Records || []).slice(0, 10).map(conciseRecord),
      viewConfig: parsed?.ViewConfiguration ? {
        keys: Object.keys(parsed.ViewConfiguration),
        value: parsed.ViewConfiguration,
      } : null,
    };
  }

  return NextResponse.json({
    tokenFound: Boolean(token),
    grid: { selectedView, pageSize, entityName, getUrl },
    filters,
    gridSummary,
  });
}
