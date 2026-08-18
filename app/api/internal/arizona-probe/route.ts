import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const PAGE_URL = "https://app.az.gov/page.aspx/en/rfp/request_browse_public";
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

function cookieHeader(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(v => v.split(";", 1)[0]).filter(Boolean).join("; ");
}

function formParams(html: string) {
  const $ = load(html);
  const params = new URLSearchParams();
  $("#mainForm input[name], #mainForm select[name], #mainForm textarea[name]").each((_, el) => {
    const node = $(el);
    const name = node.attr("name");
    if (!name) return;
    const tag = el.tagName.toLowerCase();
    const type = (node.attr("type") || "").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !node.attr("checked")) return;
    if (tag === "select") {
      const selected = node.find("option[selected]").first();
      params.set(name, selected.length ? selected.attr("value") || "" : node.find("option").first().attr("value") || "");
    } else {
      params.set(name, node.attr("value") || node.text() || "");
    }
  });
  return params;
}

function pageSummary(html: string) {
  const $ = load(html);
  const rows = $("#body_x_grid_grd tbody tr").toArray();
  return {
    title: $("title").text().trim(),
    rowCount: rows.length,
    currentPage: $("#hdnCurrentPageIndexbody_x_grid_grd").attr("value") || null,
    totalRows: $("#hdnRowCountbody_x_grid_grd").attr("value") || null,
    maxPage: $("#maxpageindexbody_x_grid_grd").attr("value") || null,
    links: $("#body_x_grid_grd a[href*='/bpm/process_manage_extranet/']").map((_, el) => ({ text: $(el).text().replace(/\s+/g, " ").trim(), href: $(el).attr("href") })).get(),
    body: $("#body_x_grid_grd").text().replace(/\s+/g, " ").trim().slice(0, 5000),
  };
}

export async function GET() {
  try {
    const first = await fetch(PAGE_URL, { headers: { accept: "text/html", "user-agent": UA }, redirect: "follow", cache: "no-store" });
    const html0 = await first.text();
    const cookie = cookieHeader(first);
    const params = formParams(html0);
    params.set("__EVENTTARGET", "body:x:grid:grd");
    params.set("__EVENTARGUMENT", "Page|1");
    params.set("REQUEST_METHOD", "POST");
    const second = await fetch(PAGE_URL, {
      method: "POST",
      headers: {
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": UA,
        origin: "https://app.az.gov",
        referer: PAGE_URL,
        ...(cookie ? { cookie } : {}),
      },
      body: params.toString(),
      redirect: "follow",
      cache: "no-store",
    });
    const html1 = await second.text();
    return NextResponse.json({
      ok: first.ok && second.ok,
      firstStatus: first.status,
      secondStatus: second.status,
      cookiePresent: Boolean(cookie),
      page0: pageSummary(html0),
      page1: pageSummary(html1),
      secondType: second.headers.get("content-type"),
      secondStart: html1.slice(0, 1000),
    }, { status: first.ok && second.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
