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

export async function GET() {
  const first = await fetch(ENTRY, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA },
    redirect: "follow",
    cache: "no-store",
  });
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
    headers: {
      accept: "text/html,application/xhtml+xml",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
      referer: first.url || ENTRY,
      origin: ROOT,
      ...(cookies.length ? { cookie: cookies.join("; ") } : {}),
    },
    body: params.toString(),
    redirect: "follow",
    cache: "no-store",
  });
  const guestHtml = await guest.text();
  cookies = mergeCookies(cookies, cookiePairs(guest));
  const g = load(guestHtml);
  const frames = g("frame,iframe").toArray().map(frame => ({
    tag: frame.tagName,
    id: g(frame).attr("id") || null,
    name: g(frame).attr("name") || null,
    src: g(frame).attr("src") || null,
    title: g(frame).attr("title") || null,
  }));
  const scripts = g("script").toArray().map(script => ({
    src: g(script).attr("src") || null,
    inline: g(script).attr("src") ? null : text(g(script).html()).slice(0, 2500),
  }));

  return NextResponse.json({
    loginStatus: first.status,
    guestStatus: guest.status,
    finalUrl: guest.url,
    cookies,
    title: text(g("title").text()),
    htmlLength: guestHtml.length,
    frames,
    scripts,
    rawHtml: guestHtml,
  });
}
