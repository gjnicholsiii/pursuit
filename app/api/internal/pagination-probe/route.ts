import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PERISCOPE_URL = "https://www.bidbuy.illinois.gov/bso/view/search/external/advancedSearchBid.xhtml?openBids=true";

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cookieHeader(setCookie: string | null) {
  if (!setCookie) return "";
  return setCookie.split(/,(?=[^;,]+=)/).map(part => part.split(";")[0].trim()).filter(Boolean).join("; ");
}

async function initialGet() {
  const response = await fetch(PERISCOPE_URL, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Illinois BidBuy returned ${response.status}`);
  return {
    html: await response.text(),
    finalUrl: response.url,
    cookie: cookieHeader(response.headers.get("set-cookie")),
  };
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function extractUpdate(xml: string, id: string) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cdata = xml.match(new RegExp(`<update[^>]+id=["']${escaped}["'][^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/update>`));
  if (cdata) return cdata[1];
  const plain = xml.match(new RegExp(`<update[^>]+id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/update>`));
  return plain ? decodeXml(plain[1]) : null;
}

async function requestPage(initial: Awaited<ReturnType<typeof initialGet>>, first: number) {
  const $ = load(initial.html);
  const form = $("#bidSearchResultsForm");
  const action = form.attr("action") || new URL(initial.finalUrl).pathname;
  const viewState = form.find('input[name="javax.faces.ViewState"]').first().attr("value") || "";
  if (!viewState) throw new Error("JSF ViewState was not found");

  const component = "bidSearchResultsForm:bidResultId";
  const body = new URLSearchParams();
  body.set("javax.faces.partial.ajax", "true");
  body.set("javax.faces.source", component);
  body.set("javax.faces.partial.execute", component);
  body.set("javax.faces.partial.render", component);
  body.set(component, component);
  body.set(`${component}_pagination`, "true");
  body.set(`${component}_first`, String(first));
  body.set(`${component}_rows`, "25");
  body.set(`${component}_skipChildren`, "true");
  body.set(`${component}_encodeFeature`, "true");
  body.set("bidSearchResultsForm", "bidSearchResultsForm");
  body.set("javax.faces.ViewState", viewState);

  const response = await fetch(new URL(action, initial.finalUrl).toString(), {
    method: "POST",
    headers: {
      accept: "application/xml, text/xml, */*; q=0.01",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "faces-request": "partial/ajax",
      "x-requested-with": "XMLHttpRequest",
      referer: initial.finalUrl,
      ...(initial.cookie ? { cookie: initial.cookie } : {}),
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    body,
    redirect: "follow",
    cache: "no-store",
  });
  const xml = await response.text();
  const updateIds = [...xml.matchAll(/<update[^>]+id=["']([^"']+)["']/g)].map(match => match[1]);
  const tableHtml = extractUpdate(xml, component);
  const table$ = load(tableHtml || "");
  const rows = table$("tbody tr").length;
  const current = compact(table$(".ui-paginator-current").first().text());
  const firstSolicitations = table$("tbody tr").slice(0, 3).map((_, row) => compact(table$(row).text()).slice(0, 300)).get();
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    bytes: xml.length,
    updateIds,
    tableFound: Boolean(tableHtml),
    rows,
    current,
    firstSolicitations,
    xmlHead: compact(xml).slice(0, 1200),
  };
}

export async function GET() {
  try {
    const initial = await initialGet();
    const $ = load(initial.html);
    const firstPageIds = $("table").filter((_, table) => /Bid Solicitation #/i.test(compact($(table).find("tr").first().text()))).first().find("tbody tr").slice(0, 3).map((_, row) => compact($(row).text()).slice(0, 300)).get();
    const page2 = await requestPage(initial, 25);
    return NextResponse.json({ ok: true, firstPageIds, page2 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
