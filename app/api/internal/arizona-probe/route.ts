import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const URL = "https://app.az.gov/page.aspx/en/rfp/request_browse_public";

export async function GET() {
  try {
    const response = await fetch(URL, {
      headers: {
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
      },
      redirect: "follow",
      cache: "no-store",
    });
    const html = await response.text();
    const $ = load(html);
    const scripts = $("script[src]").map((_, el) => $(el).attr("src")).get().slice(0, 50);
    const forms = $("form").map((_, el) => ({
      id: $(el).attr("id") || null,
      name: $(el).attr("name") || null,
      action: $(el).attr("action") || null,
      method: $(el).attr("method") || null,
    })).get();
    const tables = $("table").map((_, el) => ({
      id: $(el).attr("id") || null,
      cls: $(el).attr("class") || null,
      rows: $(el).find("tr").length,
      text: $(el).text().replace(/\s+/g, " ").trim().slice(0, 500),
    })).get().slice(0, 30);
    const links = $("a[href]").map((_, el) => ({
      text: $(el).text().replace(/\s+/g, " ").trim().slice(0, 120),
      href: $(el).attr("href") || null,
    })).get().filter(x => /rfp|bpm|request|solic|bid|ajax|json|api/i.test(`${x.text} ${x.href}`)).slice(0, 100);
    const inputs = $("input,select").map((_, el) => ({
      tag: el.tagName,
      id: $(el).attr("id") || null,
      name: $(el).attr("name") || null,
      type: $(el).attr("type") || null,
      value: $(el).attr("value") || null,
    })).get().filter(x => x.id || x.name).slice(0, 150);
    const bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 12000);
    const endpointMatches = [...html.matchAll(/(?:https?:)?\/\/[^
"'<> ]+|\/[A-Za-z0-9_.?=&%\/-]*(?:ajax|api|json|request|rfp|browse|search)[A-Za-z0-9_.?=&%\/-]*/gi)].map(m => m[0]).slice(0, 200);
    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get("content-type"),
      title: $("title").text().trim(),
      scripts,
      forms,
      tables,
      links,
      inputs,
      endpointMatches,
      bodyText,
      htmlStart: html.slice(0, 30000),
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
