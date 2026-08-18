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
function inspect(html: string, url: string) {
  const $ = load(html);
  return {
    url,
    title: text($("title").text()),
    length: html.length,
    base: $("base").attr("href") || null,
    frames: $("frame,iframe").toArray().map(frame => ({ name: $(frame).attr("name") || null, src: $(frame).attr("src") || null, title: $(frame).attr("title") || null })),
    links: $("a").toArray().map(link => ({ text: text($(link).text()), href: $(link).attr("href") || null, target: $(link).attr("target") || null, onclick: $(link).attr("onclick") || null, name: $(link).attr("name") || null, id: $(link).attr("id") || null })).filter(item => item.text || item.href || item.onclick).slice(0, 160),
    forms: $("form").toArray().map(form => ({
      name: $(form).attr("name") || null,
      id: $(form).attr("id") || null,
      action: $(form).attr("action") || null,
      method: $(form).attr("method") || null,
      controls: $(form).find("input,select,button").toArray().map(input => ({ tag: input.tagName, name: $(input).attr("name") || null, id: $(input).attr("id") || null, type: $(input).attr("type") || null, value: $(input).attr("value") || null, onclick: $(input).attr("onclick") || null, title: $(input).attr("title") || null })).filter(x => x.name || x.id || x.value || x.onclick).slice(0, 220),
    })),
    body: text($("body").text()).slice(0, 7000),
  };
}

export async function GET() {
  const first = await fetch(ENTRY, { headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA }, redirect: "follow", cache: "no-store" });
  const firstHtml = await first.text();
  let cookies = cookiePairs(first);
  const $ = load(firstHtml);
  const form = $("#login_form").first();
  const action = form.attr("action") || first.url || ENTRY;
  const params = new URLSearchParams();
  form.find("input").each((_, input) => {
    const name = $(input).attr("name");
    const type = ($(input).attr("type") || "text").toLowerCase();
    if (!name || ["submit", "button", "reset", "radio", "checkbox", "password", "text"].includes(type)) return;
    params.append(name, $(input).attr("value") || "");
  });
  params.set("guest_login", "Public Access");

  const guest = await fetch(new URL(action, first.url || ENTRY), {
    method: "POST",
    headers: { accept: "text/html,application/xhtml+xml", "content-type": "application/x-www-form-urlencoded", "user-agent": UA, referer: first.url || ENTRY, origin: ROOT, ...(cookies.length ? { cookie: cookies.join("; ") } : {}) },
    body: params.toString(), redirect: "follow", cache: "no-store",
  });
  const guestHtml = await guest.text();
  cookies = mergeCookies(cookies, cookiePairs(guest));
  const g = load(guestHtml);
  const base = g("base").attr("href") || guest.url;
  const startupSrc = g("frame[name='Startup']").attr("src") || "";
  const navSrc = g("frame[name='pPrimaryNavPanel']").attr("src") || "";

  async function getFrame(src: string) {
    if (!src) return null;
    const frameUrl = new URL(src, base).toString();
    const response = await fetch(frameUrl, { headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA, referer: guest.url, ...(cookies.length ? { cookie: cookies.join("; ") } : {}) }, redirect: "follow", cache: "no-store" });
    const html = await response.text();
    cookies = mergeCookies(cookies, cookiePairs(response));
    return { status: response.status, ...inspect(html, response.url), raw: html.slice(0, 18000) };
  }

  const [startup, navigation] = await Promise.all([getFrame(startupSrc), getFrame(navSrc)]);
  return NextResponse.json({ loginStatus: first.status, guestStatus: guest.status, cookies, startup, navigation });
}
