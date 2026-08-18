import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const PAGE_URL = "https://app.az.gov/page.aspx/en/rfp/request_browse_public";
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

function parse(html: string) {
  const $ = load(html);
  const rows = $("#body_x_grid_grd tbody tr").toArray().map(row => {
    const cells = $(row).children("td").toArray().map(td => $(td).text().replace(/\s+/g, " ").trim());
    return { code: cells[1] || null, title: cells[2] || null, agency: cells[5] || null, status: cells[7] || null, due: cells[11] || null };
  });
  return {
    rows,
    totalRows: Number($("#hdnRowCountbody_x_grid_grd").attr("value") || 0),
    maxPage: Number($("#maxpageindexbody_x_grid_grd").attr("value") || 0),
    currentPage: Number($("#hdnCurrentPageIndexbody_x_grid_grd").attr("value") || 0),
    statusValue: $("#body_x_selStatusCode_1").attr("value") || null,
  };
}

export async function GET() {
  try {
    const first = await fetch(PAGE_URL, { headers: { accept: "text/html", "user-agent": UA }, redirect: "follow", cache: "no-store" });
    const html = await first.text();
    const cookie = first.headers.get("set-cookie")?.split(",").map(v => v.split(";")[0]).join("; ") || "";
    const $ = load(html);
    const form = new URLSearchParams();
    $("#mainForm input[name], #mainForm select[name], #mainForm textarea[name]").each((_, el) => {
      const node = $(el); const name = node.attr("name"); if (!name) return;
      const type = (node.attr("type") || "").toLowerCase();
      if ((type === "checkbox" || type === "radio") && !node.attr("checked")) return;
      form.set(name, node.attr("value") || node.text() || "");
    });
    form.set("body:x:selStatusCode_1", "val");
    form.set("body_x_selStatusCode_1_text", "Open for Bidding");
    form.set("body:x:prxFilterBar:x:cmdSearchBtn", "Search");
    form.delete("__EVENTTARGET");
    form.delete("__EVENTARGUMENT");

    const filtered = await fetch(PAGE_URL, {
      method: "POST",
      headers: { accept: "text/html", "content-type": "application/x-www-form-urlencoded", "user-agent": UA, cookie, referer: PAGE_URL },
      body: form.toString(), cache: "no-store", redirect: "follow",
    });
    const filteredHtml = await filtered.text();
    const parsed = parse(filteredHtml);
    return NextResponse.json({
      ok: filtered.ok,
      status: filtered.status,
      totalRows: parsed.totalRows,
      maxPage: parsed.maxPage,
      currentPage: parsed.currentPage,
      statusValue: parsed.statusValue,
      rowCount: parsed.rows.length,
      statuses: [...new Set(parsed.rows.map(r => r.status))],
      firstFive: parsed.rows.slice(0, 5),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
