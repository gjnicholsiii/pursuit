import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const PAGE_URL = "https://app.az.gov/page.aspx/en/rfp/request_browse_public";
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

function context(html: string, needle: string, limit = 8) {
  const hits: string[] = [];
  let at = html.indexOf(needle);
  while (at >= 0 && hits.length < limit) {
    hits.push(html.slice(Math.max(0, at - 1500), Math.min(html.length, at + needle.length + 3000)));
    at = html.indexOf(needle, at + needle.length);
  }
  return hits;
}

export async function GET() {
  try {
    const response = await fetch(PAGE_URL, { headers: { accept: "text/html", "user-agent": UA }, redirect: "follow", cache: "no-store" });
    const html = await response.text();
    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      gridInit: context(html, "body_x_grid_grd"),
      newGrid: context(html, "new GridView"),
      paramsGridAjax: context(html, "_paramsGridAjax"),
      updatePanel: context(html, "_ivUpdatePanel"),
      eventTarget: context(html, "__EVENTTARGET"),
      pagePipe: context(html, "Page|"),
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
