import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PAGE_URL = "https://app.az.gov/page.aspx/en/rfp/request_browse_public";
const AJAX_BASE = "https://app.az.gov/ajax.aspx/en/rfp/request_browse_public?ivControlUIDsAsync=body%3Ax%3Agrid%3Aupgrid";
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

function cookiePairs(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(v => v.split(";", 1)[0]).filter(Boolean);
}
function mergeCookies(existing: string[], incoming: string[]) {
  const map = new Map<string, string>();
  for (const pair of [...existing, ...incoming]) {
    const at = pair.indexOf("=");
    if (at > 0) map.set(pair.slice(0, at), pair);
  }
  return [...map.values()];
}
function formParams(html: string) {
  const $ = load(html);
  const form = new URLSearchParams();
  $("#mainForm input[name], #mainForm select[name], #mainForm textarea[name]").each((_, el) => {
    const node = $(el); const name = node.attr("name"); if (!name) return;
    const tag = el.tagName.toLowerCase(); const type = (node.attr("type") || "").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !node.attr("checked")) return;
    if (tag === "select") {
      const selected = node.find("option[selected]").first();
      form.set(name, selected.length ? selected.attr("value") || "" : node.find("option").first().attr("value") || "");
    } else form.set(name, node.attr("value") || node.text() || "");
  });
  return form;
}
function parsePage(html: string) {
  const $ = load(html);
  const rows = $("#body_x_grid_grd tbody tr").toArray().map(row => {
    const cells = $(row).children("td").toArray().map(td => $(td).text().replace(/\s+/g, " ").trim());
    const link = $(row).find("a[href*='/bpm/process_manage_extranet/']").first();
    const href = link.attr("href") || "";
    return { internalId: href.match(/\/bpm\/process_manage_extranet\/(\d+)/)?.[1] || null, linkText: link.text().replace(/^Edit\s+/i, "").replace(/\s+/g, " ").trim(), cells };
  });
  return { currentPage: Number($("#hdnCurrentPageIndexbody_x_grid_grd").attr("value") || 0), totalRows: Number($("#hdnRowCountbody_x_grid_grd").attr("value") || 0), maxPage: Number($("#maxpageindexbody_x_grid_grd").attr("value") || 0), rows };
}
async function fetchPage(pageIndex: number, currentHtml: string, cookies: string[]) {
  const form = formParams(currentHtml);
  form.set("__EVENTTARGET", "body_x_grid_grd");
  form.set("__EVENTARGUMENT", `Page|${pageIndex}`);
  const response = await fetch(AJAX_BASE, {
    method: "POST",
    headers: { accept: "*/*", "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "user-agent": UA, cookie: cookies.join("; "), referer: PAGE_URL, "x-requested-with": "XMLHttpRequest", "IV-AjaxControl": "gridview", "IV-AjaxControl-ID": "body_x_grid_grd" },
    body: form.toString(), cache: "no-store", redirect: "follow",
  });
  const html = await response.text();
  if (!response.ok) throw new Error(`Arizona APP page ${pageIndex + 1} returned ${response.status}`);
  return { html, cookies: mergeCookies(cookies, cookiePairs(response)) };
}

export async function GET() {
  try {
    const first = await fetch(PAGE_URL, { headers: { accept: "text/html", "user-agent": UA }, redirect: "follow", cache: "no-store" });
    if (!first.ok) throw new Error(`Arizona APP initial page returned ${first.status}`);
    let html = await first.text(); let cookies = cookiePairs(first);
    const initial = parsePage(html); const pages: ReturnType<typeof parsePage>[] = [initial];
    for (let page = 1; page <= initial.maxPage; page += 1) {
      const next = await fetchPage(page, html, cookies); html = next.html; cookies = next.cookies;
      const parsed = parsePage(html); if (parsed.currentPage !== page) throw new Error(`Arizona APP expected page ${page}, received ${parsed.currentPage}`); pages.push(parsed);
    }
    const extra = await fetchPage(initial.maxPage + 1, html, cookies);
    const extraParsed = parsePage(extra.html);
    const allRows = pages.flatMap(page => page.rows);
    const ids = allRows.map(row => row.internalId).filter(Boolean) as string[];
    return NextResponse.json({
      ok: allRows.length === initial.totalRows && new Set(ids).size === initial.totalRows,
      totalReported: initial.totalRows,
      maxPage: initial.maxPage,
      pagesFetched: pages.length,
      rowsFetched: allRows.length,
      uniqueIds: new Set(ids).size,
      pageSizes: pages.map(page => page.rows.length),
      overflowAttempt: { requestedPage: initial.maxPage + 1, currentPage: extraParsed.currentPage, rows: extraParsed.rows.length, ids: extraParsed.rows.map(r => r.internalId), firstRows: extraParsed.rows.slice(0, 3) },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
