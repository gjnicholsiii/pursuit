import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const ROOT = "https://mevss.hostams.com";
const ENTRY = `${ROOT}/PRDVSS1X1/AltSelfService`;
const UA = "Mozilla/5.0 PursuitGovernmentRevenue/1.0";

function text(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}
function cookiePairs(response: Response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fallback = response.headers.get("set-cookie");
  return (values.length ? values : fallback ? [fallback] : []).map(v => v.split(";", 1)[0]).filter(Boolean);
}
function mergeCookies(...sets: string[][]) {
  const map = new Map<string, string>();
  for (const set of sets) for (const pair of set) {
    const eq = pair.indexOf("=");
    if (eq > 0) map.set(pair.slice(0, eq), pair);
  }
  return [...map.values()];
}
function hiddenParams(html: string, formName?: string) {
  const $ = load(html);
  const form = formName ? $(`form[name='${formName}']`).first() : $("form").first();
  const params = new URLSearchParams();
  form.find("input[type='hidden']").each((_, input) => {
    const name = $(input).attr("name");
    if (name) params.append(name, $(input).attr("value") || "");
  });
  return params;
}
function inspect(html: string, url: string) {
  const $ = load(html);
  return {
    url,
    title: text($("title").text()),
    length: html.length,
    base: $("base").attr("href") || null,
    links: $("a").toArray().map(link => ({ text: text($(link).text()), href: $(link).attr("href") || null, onclick: $(link).attr("onclick") || null, name: $(link).attr("name") || null, id: $(link).attr("id") || null })).filter(item => item.text || item.href || item.onclick).slice(0, 200),
    forms: $("form").toArray().map(form => ({
      name: $(form).attr("name") || null,
      action: $(form).attr("action") || null,
      method: $(form).attr("method") || null,
      controls: $(form).find("input,select,button").toArray().map(input => ({ tag: input.tagName, name: $(input).attr("name") || null, id: $(input).attr("id") || null, type: $(input).attr("type") || null, value: $(input).attr("value") || null, onclick: $(input).attr("onclick") || null, title: $(input).attr("title") || null })).filter(x => x.name || x.id || x.value || x.onclick).slice(0, 260),
    })),
    tables: $("table").toArray().map(table => ({ id: $(table).attr("id") || null, class: $(table).attr("class") || null, headers: $(table).find("th").toArray().map(th => text($(th).text())).filter(Boolean), text: text($(table).text()).slice(0, 4500) })).filter(item => item.headers.length || /solicitation|bid|document|closing|status/i.test(item.text)).slice(0, 80),
    body: text($("body").text()).slice(0, 10000),
  };
}
async function post(url: string, params: URLSearchParams, cookies: string[], referer: string) {
  return fetch(url, {
    method: "POST",
    headers: { accept: "text/html,application/xhtml+xml", "content-type": "application/x-www-form-urlencoded", "user-agent": UA, referer, origin: ROOT, ...(cookies.length ? { cookie: cookies.join("; ") } : {}) },
    body: params.toString(), redirect: "follow", cache: "no-store",
  });
}

export async function GET() {
  const first = await fetch(ENTRY, { headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA }, redirect: "follow", cache: "no-store" });
  const firstHtml = await first.text();
  let cookies = cookiePairs(first);
  const loginParams = hiddenParams(firstHtml, "login_form");
  loginParams.set("guest_login", "Public Access");
  const guest = await post(ENTRY, loginParams, cookies, first.url || ENTRY);
  const guestHtml = await guest.text();
  cookies = mergeCookies(cookies, cookiePairs(guest));

  const g = load(guestHtml);
  const base = g("base").attr("href") || guest.url;
  const startupSrc = g("frame[name='Startup']").attr("src") || "";
  const startupUrl = new URL(startupSrc, base).toString();
  const startupResponse = await fetch(startupUrl, { headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA, referer: guest.url, ...(cookies.length ? { cookie: cookies.join("; ") } : {}) }, redirect: "follow", cache: "no-store" });
  const startupHtml = await startupResponse.text();
  cookies = mergeCookies(cookies, cookiePairs(startupResponse));

  const searchParams = hiddenParams(startupHtml, "StartupPage");
  searchParams.set("frame_name", "Display");
  searchParams.set("query_string", 'menu_action=menu_action&ams_action=13&ams_destination="pCombSolicitation_Search"&ams_whereclause=""&ams_framesetpagename=""&ams_framename="Display"&ams_applname="VSS"&&ams_orderbyclause=""&ams_pagecode="SOSRCH"');
  const searchResponse = await post(ENTRY, searchParams, cookies, startupResponse.url);
  const searchHtml = await searchResponse.text();
  cookies = mergeCookies(cookies, cookiePairs(searchResponse));

  return NextResponse.json({
    statuses: { login: first.status, guest: guest.status, startup: startupResponse.status, search: searchResponse.status },
    cookies,
    search: { ...inspect(searchHtml, searchResponse.url), raw: searchHtml.slice(0, 30000) },
  });
}
