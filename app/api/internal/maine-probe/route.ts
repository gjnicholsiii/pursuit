import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const ROOT = "https://mevss.hostams.com";
const ENTRY = `${ROOT}/PRDVSS1X1/AltSelfService`;
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

function text(value: unknown) { return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
function cookiePairs(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(v => v.split(";", 1)[0]).filter(Boolean);
}
function mergeCookies(...sets: string[][]) {
  const map = new Map<string, string>();
  for (const set of sets) for (const pair of set) { const eq = pair.indexOf("="); if (eq > 0) map.set(pair.slice(0, eq), pair); }
  return [...map.values()];
}
function hiddenParams(html: string, formName?: string) {
  const $ = load(html); const form = formName ? $(`form[name='${formName}']`).first() : $("form").first(); const params = new URLSearchParams();
  form.find("input[type='hidden']").each((_, input) => { const name = $(input).attr("name"); if (name) params.append(name, $(input).attr("value") || ""); });
  return params;
}
async function post(params: URLSearchParams, cookies: string[], referer: string) {
  return fetch(ENTRY, { method: "POST", headers: { accept: "text/html,application/xhtml+xml", "content-type": "application/x-www-form-urlencoded", "user-agent": UA, referer, origin: ROOT, ...(cookies.length ? { cookie: cookies.join("; ") } : {}) }, body: params.toString(), redirect: "follow", cache: "no-store" });
}
function pageSummary(html: string) {
  const $ = load(html);
  const docRefsMatch = html.match(/var\s+lsDocReference\s*=\s*\[([^\]]*)\]/i);
  const refs = docRefsMatch ? [...docRefsMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]).filter(v => v.trim()) : [];
  const detailInputs = $("input[name*='T1SO_SRCH_QRYpagenav']").toArray().map(input => {
    const row = $(input).closest("tr");
    const parentRow = row.parent().closest("tr");
    return { name: $(input).attr("name") || null, rowText: text(row.text()), parentRowText: text(parentRow.text()).slice(0, 1800) };
  });
  const next = $("input[name='T1SO_SRCH_QRYnextpage']").first();
  const last = $("input[name='T1SO_SRCH_QRYLastpage']").first();
  const navText = $("input[name='T1SO_SRCH_QRYnextpage']").first().closest("table").text();
  const body = text($("body").text());
  const countMatches = [...body.matchAll(/(?:rows?|records?|results?|items?)\s*[:#]?\s*(\d+)\s*(?:-|to|of)\s*(\d+)(?:\s*of\s*(\d+))?/gi)].map(m => m[0]).slice(0, 20);
  return {
    title: text($("title").text()),
    refs,
    detailInputs,
    next: { exists: next.length > 0, disabled: next.is(":disabled") || next.attr("disabled") !== undefined, value: next.attr("value") || null, class: next.attr("class") || null },
    last: { exists: last.length > 0, disabled: last.is(":disabled") || last.attr("disabled") !== undefined, value: last.attr("value") || null, class: last.attr("class") || null },
    navText: text(navText).slice(0, 1000),
    countMatches,
    hidden: $("input[type='hidden']").toArray().map(i => ({ name: $(i).attr("name") || null, value: $(i).attr("value") || null })).filter(x => x.name && x.value).slice(-40),
    bodyTail: body.slice(-3500),
  };
}

export async function GET() {
  const first = await fetch(ENTRY, { headers: { accept: "text/html", "user-agent": UA }, redirect: "follow", cache: "no-store" });
  const firstHtml = await first.text(); let cookies = cookiePairs(first);
  const login = hiddenParams(firstHtml, "login_form"); login.set("guest_login", "Public Access");
  const guest = await post(login, cookies, first.url || ENTRY); const guestHtml = await guest.text(); cookies = mergeCookies(cookies, cookiePairs(guest));
  const g = load(guestHtml); const base = g("base").attr("href") || guest.url; const startupUrl = new URL(g("frame[name='Startup']").attr("src") || "", base).toString();
  const startup = await fetch(startupUrl, { headers: { accept: "text/html", "user-agent": UA, referer: guest.url, ...(cookies.length ? { cookie: cookies.join("; ") } : {}) }, cache: "no-store" });
  const startupHtml = await startup.text(); cookies = mergeCookies(cookies, cookiePairs(startup));
  const enter = hiddenParams(startupHtml, "StartupPage"); enter.set("frame_name", "Display"); enter.set("query_string", 'menu_action=menu_action&ams_action=13&ams_destination="pCombSolicitation_Search"&ams_whereclause=""&ams_framesetpagename=""&ams_framename="Display"&ams_applname="VSS"&&ams_orderbyclause=""&ams_pagecode="SOSRCH"');
  const search = await post(enter, cookies, startup.url); const searchHtml = await search.text(); cookies = mergeCookies(cookies, cookiePairs(search));

  const openParams = hiddenParams(searchHtml, "pCombSolicitation_Search"); openParams.set("frame_name", "Display"); openParams.set("query_string", "AMSBrowseOpenSolicit=AMSBrowseOpenSolicit");
  const open = await post(openParams, cookies, search.url); const openHtml = await open.text(); cookies = mergeCookies(cookies, cookiePairs(open));

  const nextParams = hiddenParams(openHtml, "pCombSolicitation_Search"); nextParams.set("T1SO_SRCH_QRYnextpage", "Next");
  const next = await post(nextParams, cookies, open.url); const nextHtml = await next.text(); cookies = mergeCookies(cookies, cookiePairs(next));

  return NextResponse.json({ statuses: [first.status, guest.status, startup.status, search.status, open.status, next.status], firstOpenPage: pageSummary(openHtml), secondOpenPage: pageSummary(nextHtml) });
}
