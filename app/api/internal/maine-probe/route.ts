import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const ROOT = "https://mevss.hostams.com";
const URL = `${ROOT}/PRDVSS1X1/AltSelfService`;
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
function describePage(html: string, finalUrl: string) {
  const $ = load(html);
  return {
    finalUrl,
    title: text($("title").text()),
    htmlLength: html.length,
    forms: $("form").toArray().map(form => ({
      id: $(form).attr("id") || null,
      name: $(form).attr("name") || null,
      method: $(form).attr("method") || null,
      action: $(form).attr("action") || null,
      inputs: $(form).find("input,button,select").toArray().map(input => ({
        tag: input.tagName,
        id: $(input).attr("id") || null,
        name: $(input).attr("name") || null,
        type: $(input).attr("type") || null,
        value: $(input).attr("value") || null,
        title: $(input).attr("title") || null,
        onclick: $(input).attr("onclick") || null,
        text: text($(input).text()),
      })).filter(item => item.name || item.id || item.value || item.onclick).slice(0, 180),
    })),
    links: $("a").toArray().map(link => ({
      text: text($(link).text()),
      href: $(link).attr("href") || null,
      onclick: $(link).attr("onclick") || null,
      id: $(link).attr("id") || null,
    })).filter(item => /solicitation|contract|bid|search|home|document/i.test(`${item.text} ${item.href} ${item.onclick}`)).slice(0, 120),
    tables: $("table").toArray().map(table => ({
      id: $(table).attr("id") || null,
      class: $(table).attr("class") || null,
      text: text($(table).text()).slice(0, 1500),
    })).filter(item => /solicitation|bid|contract|search|document/i.test(item.text)).slice(0, 50),
    bodyExcerpt: text($("body").text()).slice(0, 5000),
  };
}

export async function GET() {
  const first = await fetch(URL, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA },
    redirect: "follow",
    cache: "no-store",
  });
  const firstHtml = await first.text();
  let cookies = cookiePairs(first);
  const $ = load(firstHtml);
  const form = $("#login_form").first();
  const action = form.attr("action") || first.url || URL;
  const params = new URLSearchParams();
  form.find("input").each((_, input) => {
    const name = $(input).attr("name");
    const type = ($(input).attr("type") || "text").toLowerCase();
    if (!name || ["submit", "button", "reset", "radio", "checkbox", "password", "text"].includes(type)) return;
    params.append(name, $(input).attr("value") || "");
  });
  params.set("guest_login", "Public Access");

  const guest = await fetch(new URL(action, first.url || URL), {
    method: "POST",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
      referer: first.url || URL,
      origin: ROOT,
      ...(cookies.length ? { cookie: cookies.join("; ") } : {}),
    },
    body: params.toString(),
    redirect: "follow",
    cache: "no-store",
  });
  const guestHtml = await guest.text();
  cookies = mergeCookies(cookies, cookiePairs(guest));

  return NextResponse.json({
    loginStatus: first.status,
    guestStatus: guest.status,
    cookies,
    submittedKeys: [...params.keys()],
    page: describePage(guestHtml, guest.url),
  });
}
