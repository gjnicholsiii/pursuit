import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const PAGE_URL = "https://app.az.gov/page.aspx/en/rfp/request_browse_public";
const AJAX_URL = "https://app.az.gov/ajax.aspx/en/rfp/request_browse_public?ivControlUIDsAsync=body%3Ax%3Agrid%3Aupgrid";
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

function parse(html: string) {
  const $ = load(html);
  return {
    rows: $("#body_x_grid_grd tbody tr").length,
    currentPage: $("#hdnCurrentPageIndexbody_x_grid_grd").attr("value") || null,
    totalRows: $("#hdnRowCountbody_x_grid_grd").attr("value") || null,
    ids: $("#body_x_grid_grd a[href*='/bpm/process_manage_extranet/']").map((_, el) => $(el).attr("href")?.split("/").pop()).get(),
    labels: $("#body_x_grid_grd a[href*='/bpm/process_manage_extranet/']").map((_, el) => $(el).text().replace(/^Edit\s+/i, "").trim()).get(),
  };
}

export async function GET() {
  try {
    const first = await fetch(PAGE_URL, {
      headers: { accept: "text/html", "user-agent": UA },
      redirect: "follow",
      cache: "no-store",
    });
    const html = await first.text();
    const cookie = first.headers.get("set-cookie")?.split(",").map(v => v.split(";")[0]).join("; ") || "";
    const $ = load(html);
    const form = new URLSearchParams();
    $("#mainForm input, #mainForm select, #mainForm textarea").each((_, el) => {
      const name = $(el).attr("name");
      if (!name) return;
      const type = ($(el).attr("type") || "").toLowerCase();
      if ((type === "checkbox" || type === "radio") && !$(el).attr("checked")) return;
      form.append(name, $(el).attr("value") || "");
    });
    form.set("__EVENTTARGET", "body_x_grid_grd");
    form.set("__EVENTARGUMENT", "Page|1");
    form.set("hdnCurrentPageIndexbody_x_grid_grd", "0");
    form.set("hdnRowCountbody_x_grid_grd", "151");
    form.set("maxpageindexbody_x_grid_grd", "9");

    const second = await fetch(AJAX_URL, {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "user-agent": UA,
        cookie,
        referer: PAGE_URL,
        "x-requested-with": "XMLHttpRequest",
        "IV-AjaxControl": "gridview",
        "IV-AjaxControl-ID": "body_x_grid_grd",
      },
      body: form.toString(),
      cache: "no-store",
      redirect: "follow",
    });
    const secondText = await second.text();
    return NextResponse.json({
      ok: first.ok && second.ok,
      firstStatus: first.status,
      secondStatus: second.status,
      cookiePresent: Boolean(cookie),
      page0: parse(html),
      secondType: second.headers.get("content-type"),
      secondLength: secondText.length,
      secondStart: secondText.slice(0, 3000),
      parsedSecond: parse(secondText),
    }, { status: first.ok && second.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
