import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PERISCOPE_URL = "https://www.bidbuy.illinois.gov/bso/view/search/external/advancedSearchBid.xhtml?openBids=true";
const JAGGAER_URL = "https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=DASIowa";

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cookieHeader(setCookie: string | null) {
  if (!setCookie) return "";
  return setCookie.split(/,(?=[^;,]+=)/).map(part => part.split(";")[0].trim()).filter(Boolean).join("; ");
}

async function initialGet(url: string) {
  const response = await fetch(url, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return {
    html: await response.text(),
    finalUrl: response.url,
    cookie: cookieHeader(response.headers.get("set-cookie")),
  };
}

async function testPeriscopeExport(initial: Awaited<ReturnType<typeof initialGet>>) {
  const $ = load(initial.html);
  const form = $("#bidSearchResultsForm");
  const action = form.attr("action") || new URL(initial.finalUrl).pathname;
  const viewState = form.find('input[name="javax.faces.ViewState"]').first().attr("value") || "";
  const csv = form.find('a[title="Export to CSV File"]').first();
  const onclick = csv.attr("onclick") || "";
  const command = onclick.match(/\{'([^']+)':'([^']+)'\}/)?.[1] || "";
  if (!viewState || !command) throw new Error("Periscope CSV export command was not found");

  const body = new URLSearchParams();
  body.set("bidSearchResultsForm", "bidSearchResultsForm");
  body.set(command, command);
  body.set("javax.faces.ViewState", viewState);

  const postUrl = new URL(action, initial.finalUrl).toString();
  const response = await fetch(postUrl, {
    method: "POST",
    headers: {
      accept: "text/csv,text/plain,*/*",
      "content-type": "application/x-www-form-urlencoded",
      referer: initial.finalUrl,
      ...(initial.cookie ? { cookie: initial.cookie } : {}),
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    body,
    redirect: "follow",
    cache: "no-store",
  });
  const payload = await response.text();
  const lines = payload.split(/\r?\n/).filter(line => line.trim().length > 0);
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    contentDisposition: response.headers.get("content-disposition"),
    bytes: payload.length,
    nonEmptyLines: lines.length,
    firstLines: lines.slice(0, 5),
  };
}

function formParams(html: string) {
  const $ = load(html);
  const form = $('form[name="ActiveForm"]').first();
  const params = new URLSearchParams();
  form.find("input[name]").each((_, node) => {
    const input = $(node);
    const name = input.attr("name");
    if (!name) return;
    const type = (input.attr("type") || "text").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !input.is(":checked")) return;
    if (["submit", "button", "image", "file"].includes(type)) return;
    params.append(name, input.attr("value") || "");
  });
  form.find("select[name]").each((_, node) => {
    const select = $(node);
    const name = select.attr("name");
    if (!name) return;
    const selected = select.find("option:selected").attr("value") || select.find("option").first().attr("value") || "";
    params.set(name, selected);
  });
  return { action: form.attr("action") || "", params };
}

function functionSnippet(source: string, name: string) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return null;
  return compact(source.slice(start, start + 3000));
}

async function testJaggaerPageSize(initial: Awaited<ReturnType<typeof initialGet>>) {
  const $ = load(initial.html);
  const scriptSrc = $('script[src*="CombinedJavascript.js"]').first().attr("src") || "";
  let functions: Record<string, string | null> = {};
  if (scriptSrc) {
    const scriptResponse = await fetch(new URL(scriptSrc, initial.finalUrl), {
      headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
      cache: "no-store",
    });
    const source = scriptResponse.ok ? await scriptResponse.text() : "";
    functions = {
      submitSizeChange: functionSnippet(source, "submitSizeChange"),
      submitPageChange: functionSnippet(source, "submitPageChange"),
      goToPage: functionSnippet(source, "goToPage"),
    };
  }

  const built = formParams(initial.html);
  built.params.set("PageSize", "200");
  built.params.set("PageNum", "1");
  built.params.set("ESSearchAfter", "");
  const postUrl = new URL(built.action || initial.finalUrl, initial.finalUrl).toString();
  const response = await fetch(postUrl, {
    method: "POST",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "content-type": "application/x-www-form-urlencoded",
      referer: initial.finalUrl,
      ...(initial.cookie ? { cookie: initial.cookie } : {}),
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    body: built.params,
    redirect: "follow",
    cache: "no-store",
  });
  const html = await response.text();
  const result$ = load(html);
  const resultText = compact(result$(".readOnlyPageOf").first().text());
  const hiddenPageSize = result$('input[name="PageSize"]').first().attr("value") || null;
  const hiddenPageNum = result$('input[name="PageNum"]').first().attr("value") || null;
  const eventRows = result$('a[href*="app01.jaggaer.com/apps/Router/ViewSourcingEvent"]').length;
  return {
    status: response.status,
    finalUrl: response.url,
    resultText,
    hiddenPageSize,
    hiddenPageNum,
    eventRows,
    functions,
  };
}

export async function GET() {
  try {
    const [periscope, jaggaer] = await Promise.all([initialGet(PERISCOPE_URL), initialGet(JAGGAER_URL)]);
    const [periscopeExport, jaggaerPage200] = await Promise.all([
      testPeriscopeExport(periscope),
      testJaggaerPageSize(jaggaer),
    ]);
    return NextResponse.json({ ok: true, periscopeExport, jaggaerPage200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
