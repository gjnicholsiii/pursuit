import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const PAGE_URL = "https://app.az.gov/page.aspx/en/rfp/request_browse_public";
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

export async function GET() {
  try {
    const response = await fetch(PAGE_URL, { headers: { accept: "text/html", "user-agent": UA }, redirect: "follow", cache: "no-store" });
    const html = await response.text();
    const $ = load(html);
    const status = $("#body_x_selStatusCode_1");
    const options = status.find("option").map((_, el) => ({
      value: $(el).attr("value") || "",
      text: $(el).text().replace(/\s+/g, " ").trim(),
      selected: $(el).attr("selected") !== undefined,
    })).get();
    const searchButtons = $("button, input[type='submit'], input[type='button'], a").map((_, el) => ({
      id: $(el).attr("id") || null,
      name: $(el).attr("name") || null,
      text: $(el).text().replace(/\s+/g, " ").trim() || $(el).attr("value") || "",
      onclick: $(el).attr("onclick") || null,
    })).get().filter(x => /search|filter/i.test(`${x.id} ${x.name} ${x.text} ${x.onclick}`)).slice(0, 40);
    const selectedControls = $("[id*='selStatusCode']").map((_, el) => ({ tag: el.tagName, id: $(el).attr("id") || null, name: $(el).attr("name") || null, value: $(el).attr("value") || null, text: $(el).text().replace(/\s+/g, " ").trim().slice(0, 500) })).get();
    return NextResponse.json({ ok: response.ok, status: response.status, options, searchButtons, selectedControls });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
