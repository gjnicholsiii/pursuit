import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const PAGE_URL = "https://app.az.gov/page.aspx/en/rfp/request_browse_public";
const ORIGIN = "https://app.az.gov";

function snippets(text: string, needles: string[]) {
  const out: Record<string, string[]> = {};
  for (const needle of needles) {
    const hits: string[] = [];
    let at = text.indexOf(needle);
    while (at >= 0 && hits.length < 12) {
      hits.push(text.slice(Math.max(0, at - 700), Math.min(text.length, at + needle.length + 1400)));
      at = text.indexOf(needle, at + needle.length);
    }
    out[needle] = hits;
  }
  return out;
}

export async function GET() {
  try {
    const response = await fetch(PAGE_URL, {
      headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
      redirect: "follow",
      cache: "no-store",
    });
    const html = await response.text();
    const $ = load(html);
    const scriptSrcs = $("script[src]").map((_, el) => $(el).attr("src")).get().filter(Boolean) as string[];
    const scriptResults = [];
    for (const src of scriptSrcs.filter(src => /global_defer|global_script|rfp_public|rfp_script/i.test(src)).slice(0, 6)) {
      const scriptUrl = new globalThis.URL(src, ORIGIN).toString();
      const r = await fetch(scriptUrl, { headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, cache: "no-store" });
      const text = await r.text();
      scriptResults.push({
        src,
        status: r.status,
        length: text.length,
        snippets: snippets(text, ["hdnCurrentPageIndex", "maxpageindex", "ajax.aspx", "PageIndex", "currentPage", "pageindex", "grid_grd"]),
      });
    }
    const hidden: Record<string, string | null> = {};
    $("input[type='hidden']").each((_, el) => {
      const name = $(el).attr("name") || $(el).attr("id");
      if (name && /grid|page|csrf|viewstate|event/i.test(name)) hidden[name] = $(el).attr("value") || null;
    });
    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      title: $("title").text().trim(),
      gridRows: $("#body_x_grid_grd tbody tr").length,
      links: $("#body_x_grid_grd a[href]").map((_, el) => ({ text: $(el).text().replace(/\s+/g, " ").trim(), href: $(el).attr("href") })).get().slice(0, 25),
      hidden,
      formAction: $("#mainForm").attr("action") || null,
      scriptResults,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
