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

function serializeForm(html: string) {
  const $ = load(html);
  const form = $("#bidSearchResultsForm");
  if (!form.length) throw new Error("bidSearchResultsForm was not found");
  const body = new URLSearchParams();

  form.find("input[name]").each((_, node) => {
    const input = $(node);
    const name = input.attr("name");
    if (!name) return;
    const type = (input.attr("type") || "text").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !input.is(":checked")) return;
    if (["submit", "button", "image", "file"].includes(type)) return;
    body.append(name, input.attr("value") || "");
  });
  form.find("select[name]").each((_, node) => {
    const select = $(node);
    const name = select.attr("name");
    if (!name) return;
    select.find("option:selected").each((__, option) => body.append(name, $(option).attr("value") || ""));
  });
  form.find("textarea[name]").each((_, node) => {
    const field = $(node);
    const name = field.attr("name");
    if (name) body.append(name, field.text());
  });
  if (!body.has("bidSearchResultsForm")) body.set("bidSearchResultsForm", "bidSearchResultsForm");
  return {
    action: form.attr("action") || "",
    body,
    fieldNames: [...new Set([...body.keys()])],
  };
}

async function requestPage(initial: Awaited<ReturnType<typeof initialGet>>, first: number, useCurrentUrl: boolean) {
  const built = serializeForm(initial.html);
  const component = "bidSearchResultsForm:bidResultId";
  built.body.set("javax.faces.partial.ajax", "true");
  built.body.set("javax.faces.source", component);
  built.body.set("javax.faces.partial.execute", component);
  built.body.set("javax.faces.partial.render", component);
  built.body.set(component, component);
  built.body.set(`${component}_pagination`, "true");
  built.body.set(`${component}_first`, String(first));
  built.body.set(`${component}_rows`, "25");
  built.body.set(`${component}_skipChildren`, "true");
  built.body.set(`${component}_encodeFeature`, "true");

  const postUrl = useCurrentUrl ? initial.finalUrl : new URL(built.action || initial.finalUrl, initial.finalUrl).toString();
  const response = await fetch(postUrl, {
    method: "POST",
    headers: {
      accept: "application/xml, text/xml, */*; q=0.01",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "faces-request": "partial/ajax",
      "x-requested-with": "XMLHttpRequest",
      origin: new URL(initial.finalUrl).origin,
      referer: initial.finalUrl,
      ...(initial.cookie ? { cookie: initial.cookie } : {}),
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    body: built.body,
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
    xmlHead: compact(xml).slice(0, 800),
  };
}

export async function GET() {
  try {
    const first = await initialGet();
    const second = await initialGet();
    const firstBuilt = serializeForm(first.html);
    const cookieNames = first.cookie.split(";").map(piece => piece.split("=")[0].trim()).filter(Boolean);
    const [actionPost, currentUrlPost] = await Promise.all([
      requestPage(first, 25, false),
      requestPage(second, 25, true),
    ]);
    return NextResponse.json({
      ok: true,
      formFieldNames: firstBuilt.fieldNames,
      cookieNames,
      actionPost,
      currentUrlPost,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
