import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const NC = "https://evp.nc.gov/solicitations/?status=0";
const CA_PSP = "https://caleprocure.ca.gov/psp/psfpd1_3/SUPPLIER/ERP/c/AUC_MANAGE_BIDS.AUC_RESP_INQ_AUC.GBL";
const CA_PSC = "https://caleprocure.ca.gov/psc/psfpd1_3/SUPPLIER/ERP/c/AUC_MANAGE_BIDS.AUC_RESP_INQ_AUC.GBL";

function attrs($: ReturnType<typeof load>, node: any) {
  return Object.fromEntries(Object.entries(node?.attribs || {}).map(([k, v]) => [k, String(v).slice(0, 1000)]));
}

async function probeNc() {
  const response = await fetch(NC, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    redirect: "follow",
    cache: "no-store",
  });
  const html = await response.text();
  const $ = load(html);
  const grids = $(".entitylist, .entity-grid, [data-entitylist-id], [data-url*='entity-grid']").toArray().slice(0, 10).map(node => ({
    tag: node.tagName,
    attrs: attrs($, node),
    html: $.html(node).slice(0, 12000),
  }));
  const serviceHits = [...html.matchAll(/[^\"'\s<>]{0,120}(?:_services\/entity-grid|entity-grid|entitylistid|data-url|fetchxml)[^\"'\s<>]{0,300}/gi)].slice(0, 40).map(m => m[0]);
  const urls = [...new Set([...html.matchAll(/(?:https?:\/\/[^\"'\s<>]+|\/_services\/[^\"'\s<>]+)/gi)].map(m => m[0]))].filter(v => /entity|grid|api|service/i.test(v)).slice(0, 60);
  return {
    status: response.status,
    finalUrl: response.url,
    title: $("title").text().replace(/\s+/g, " ").trim(),
    htmlLength: html.length,
    grids,
    serviceHits,
    urls,
  };
}

function collectCookies(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(v => v.split(";", 1)[0]);
}

async function probeCa() {
  const first = await fetch(CA_PSP, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    redirect: "manual",
    cache: "no-store",
  });
  const cookies = collectCookies(first);
  const location = first.headers.get("location");
  const secondUrl = location ? new URL(location, CA_PSP).toString() : CA_PSP;
  const headers = {
    accept: "text/html,application/xhtml+xml",
    "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    ...(cookies.length ? { cookie: cookies.join("; ") } : {}),
  };
  const second = await fetch(secondUrl, { headers, redirect: "follow", cache: "no-store" });
  const secondCookies = collectCookies(second);
  const allCookies = [...new Map([...cookies, ...secondCookies].map(v => [v.split("=")[0], v])).values()];
  const component = await fetch(CA_PSC, {
    headers: { ...headers, ...(allCookies.length ? { cookie: allCookies.join("; ") } : {}) },
    redirect: "follow",
    cache: "no-store",
  });
  const html = await component.text();
  const $ = load(html);
  const body = $("body").text().replace(/\s+/g, " ").trim();
  return {
    firstStatus: first.status,
    firstLocation: location,
    cookieNames: allCookies.map(v => v.split("=")[0]),
    status: component.status,
    finalUrl: component.url,
    title: $("title").text().replace(/\s+/g, " ").trim(),
    htmlLength: html.length,
    bodyStart: body.slice(0, 10000),
    tables: $("table").length,
    rows: $("table tr").length,
    forms: $("form").toArray().slice(0, 5).map(form => ({ id: $(form).attr("id") || null, action: $(form).attr("action") || null, method: $(form).attr("method") || null })),
    hiddenInputs: $("input[type=hidden]").toArray().slice(0, 100).map(input => ({ name: $(input).attr("name") || null, id: $(input).attr("id") || null, value: ($(input).attr("value") || "").slice(0, 600) })),
    visibleInputs: $("input:not([type=hidden]), select").toArray().slice(0, 100).map(input => ({ tag: input.tagName, name: $(input).attr("name") || null, id: $(input).attr("id") || null, value: ($(input).attr("value") || "").slice(0, 300), title: $(input).attr("title") || null })),
    tableText: $("table").toArray().slice(0, 20).map(table => $(table).text().replace(/\s+/g, " ").trim().slice(0, 4000)),
  };
}

export async function GET() {
  const [nc, ca] = await Promise.allSettled([probeNc(), probeCa()]);
  return NextResponse.json({
    nc: nc.status === "fulfilled" ? nc.value : { error: String(nc.reason) },
    ca: ca.status === "fulfilled" ? ca.value : { error: String(ca.reason) },
  });
}
