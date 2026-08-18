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

export async function GET() {
  const response = await fetch(URL, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA },
    redirect: "follow",
    cache: "no-store",
  });
  const html = await response.text();
  const $ = load(html);

  const forms = $("form").toArray().map(form => ({
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
      alt: $(input).attr("alt") || null,
      onclick: $(input).attr("onclick") || null,
      text: text($(input).text()),
    })).filter(item => item.name || item.id || item.value || item.onclick).slice(0, 120),
  }));

  const links = $("a").toArray().map(link => ({
    text: text($(link).text()),
    href: $(link).attr("href") || null,
    onclick: $(link).attr("onclick") || null,
    id: $(link).attr("id") || null,
  })).filter(item => /guest|solicitation|contract|public|bid/i.test(`${item.text} ${item.href} ${item.onclick}`)).slice(0, 80);

  const scripts = $("script").toArray().map(script => ({
    src: $(script).attr("src") || null,
    inline: $(script).attr("src") ? null : text($(script).html()).slice(0, 1500),
  })).filter(item => item.src || /guest|solicitation|submit|post/i.test(item.inline || "")).slice(0, 60);

  const bodyText = text($("body").text());
  const guestIndex = html.search(/continue\s*as\s*guest|guest/i);
  const solicitationIndex = html.search(/solicitation/i);

  return NextResponse.json({
    status: response.status,
    finalUrl: response.url,
    htmlLength: html.length,
    contentType: response.headers.get("content-type"),
    cookies: response.headers.get("set-cookie")?.split(/,(?=[^;,]+=)/).map(v => v.split(";", 1)[0]).slice(0, 10) || [],
    title: text($("title").text()),
    forms,
    links,
    scripts,
    bodyExcerpt: bodyText.slice(0, 2500),
    guestHtml: guestIndex >= 0 ? html.slice(Math.max(0, guestIndex - 2500), guestIndex + 4500) : null,
    solicitationHtml: solicitationIndex >= 0 ? html.slice(Math.max(0, solicitationIndex - 2000), solicitationIndex + 4000) : null,
  });
}
