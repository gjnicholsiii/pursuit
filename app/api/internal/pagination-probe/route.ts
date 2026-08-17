import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PERISCOPE_URL = "https://www.bidbuy.illinois.gov/bso/view/search/external/advancedSearchBid.xhtml?openBids=true";
const JAGGAER_URL = "https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=DASIowa";

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function tagName(node: unknown) {
  return (node as { tagName?: string } | null)?.tagName || null;
}

async function getHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return { html: await response.text(), finalUrl: response.url };
}

function periscopeDetails(html: string) {
  const $ = load(html);
  const forms = $("form").toArray().map(form => ({
    id: $(form).attr("id") || null,
    name: $(form).attr("name") || null,
    action: $(form).attr("action") || null,
    method: $(form).attr("method") || null,
  }));
  const hidden = $('input[type="hidden"]').toArray().map(input => ({
    id: $(input).attr("id") || null,
    name: $(input).attr("name") || null,
    value: ($(input).attr("value") || "").slice(0, 500),
  })).filter(item => /viewstate|javax\.faces|pagination|page|first/i.test(`${item.id} ${item.name}`));
  const paginator = $("*[class*='paginator'], *[id*='paginator'], *[class*='pagination'], *[id*='pagination']").toArray().slice(0, 20).map(node => ({
    tag: tagName(node),
    id: $(node).attr("id") || null,
    className: $(node).attr("class") || null,
    text: compact($(node).text()).slice(0, 500),
    html: compact($.html(node)).slice(0, 4000),
  }));
  const nextish = $("a,button,input").toArray().filter(node => /next|last|page|rows/i.test(compact($(node).text()) + " " + ($(node).attr("title") || "") + " " + ($(node).attr("aria-label") || "") + " " + ($(node).attr("id") || "") + " " + ($(node).attr("name") || ""))).slice(0, 30).map(node => ({
    tag: tagName(node),
    id: $(node).attr("id") || null,
    name: $(node).attr("name") || null,
    href: $(node).attr("href") || null,
    onclick: ($(node).attr("onclick") || "").slice(0, 1500) || null,
    value: $(node).attr("value") || null,
    title: $(node).attr("title") || null,
    text: compact($(node).text()).slice(0, 200),
  }));
  const scripts = $("script").toArray().map(node => compact($(node).html() || "")).filter(script => /paginator|pagination|first|rows|page/i.test(script)).slice(0, 10).map(script => script.slice(0, 5000));
  return { forms, hidden, paginator, nextish, scripts };
}

function jaggaerDetails(html: string) {
  const $ = load(html);
  const forms = $("form").toArray().map(form => ({
    id: $(form).attr("id") || null,
    name: $(form).attr("name") || null,
    action: $(form).attr("action") || null,
    method: $(form).attr("method") || null,
  }));
  const inputs = $("input,select,button").toArray().filter(node => /page|result|sort|search|nav/i.test(`${$(node).attr("id") || ""} ${$(node).attr("name") || ""} ${$(node).attr("aria-label") || ""} ${$(node).attr("title") || ""}`)).slice(0, 40).map(node => ({
    tag: tagName(node),
    id: $(node).attr("id") || null,
    name: $(node).attr("name") || null,
    type: $(node).attr("type") || null,
    value: $(node).attr("value") || null,
    onclick: ($(node).attr("onclick") || "").slice(0, 2000) || null,
    onchange: ($(node).attr("onchange") || "").slice(0, 2000) || null,
  }));
  const pageTextNodes = $("body *").toArray().filter(node => /\bPage\b|\bResults\b|Per Page/i.test(compact($(node).text()))).slice(-30).map(node => ({
    tag: tagName(node),
    id: $(node).attr("id") || null,
    className: $(node).attr("class") || null,
    text: compact($(node).text()).slice(0, 500),
    html: compact($.html(node)).slice(0, 5000),
  }));
  const scripts = $("script").toArray().map(node => compact($(node).html() || "")).filter(script => /page|paging|pagination|results|sourcing/i.test(script)).slice(0, 15).map(script => script.slice(0, 6000));
  const scriptSrc = $("script[src]").toArray().map(node => $(node).attr("src") || null).filter((value): value is string => Boolean(value)).slice(0, 50);
  return { forms, inputs, pageTextNodes, scripts, scriptSrc };
}

export async function GET() {
  try {
    const [periscope, jaggaer] = await Promise.all([getHtml(PERISCOPE_URL), getHtml(JAGGAER_URL)]);
    return NextResponse.json({
      ok: true,
      periscope: { finalUrl: periscope.finalUrl, ...periscopeDetails(periscope.html) },
      jaggaer: { finalUrl: jaggaer.finalUrl, ...jaggaerDetails(jaggaer.html) },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
