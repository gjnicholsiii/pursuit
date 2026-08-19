import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const osp = "https://webprocure.proactiscloud.com/wp-web-public/";
const rivip = "https://www.purchasing.ri.gov/bidding/ExternalBidSearch.aspx";
function compact(value: string) { return value.replace(/\s+/g, " ").trim(); }

function buildPost(html: string) {
  const $ = load(html);
  const body = new URLSearchParams();
  $("input[type=hidden][name]").each((_, el) => body.append($(el).attr("name")!, $(el).attr("value") || ""));
  body.set("ctl00$ContentPlaceHolder1$SM_ExternalbidSearch", "ctl00$ContentPlaceHolder1$updpan_ExternalbidSearch|ctl00$ContentPlaceHolder1$btn_ExSearch");
  body.set("__ASYNCPOST", "true");
  body.set("__EVENTTARGET", "");
  body.set("__EVENTARGUMENT", "");
  body.set("ctl00$ContentPlaceHolder1$ddl_ExBiddingGroup", "All External Bidding Groups");
  body.set("ctl00$ContentPlaceHolder1$chkbox_ExSelectAll", "on");
  $("#ctl00_ContentPlaceHolder1_lstbox_ExBiddingEntities option").each((_, el) => body.append("ctl00$ContentPlaceHolder1$lstbox_ExBiddingEntities", $(el).attr("value") || compact($(el).text())));
  body.set("ctl00$ContentPlaceHolder1$txtbox_ExBidNumber", "");
  body.set("ctl00$ContentPlaceHolder1$chk_SelectAll_ExBidStatus", "on");
  body.append("ctl00$ContentPlaceHolder1$lstbox_ExBidStatus", "Active(Scheduled)");
  body.set("ctl00$ContentPlaceHolder1$txtbox_ExKeywords", "");
  body.set("ctl00$ContentPlaceHolder1$txtbox_ExOpeningAfter", "");
  body.set("ctl00$ContentPlaceHolder1$txtbox_ExOpeningBefore", "");
  body.set("ctl00$ContentPlaceHolder1$btn_ExSearch", "Search");
  return body;
}

function inspect(text: string) {
  const $ = load(text);
  const messages = $("span,div,label").toArray().map(el => compact($(el).text())).filter(v => /please|required|select|no records|no solicitations|found|result/i.test(v) && v.length < 500).slice(0, 80);
  const rows = $("tr").toArray().map((row, i) => ({
    i,
    cells: $(row).find("th,td").toArray().map(cell => compact($(cell).text())),
    links: $(row).find("a[href]").toArray().map(a => ({ text: compact($(a).text()), href: $(a).attr("href") || "" })),
  })).filter(r => r.links.length || r.cells.some(c => /solicitation|opening|bid number|status|description/i.test(c))).slice(-120);
  const links = $("a[href]").toArray().map(a => ({ text: compact($(a).text()), href: $(a).attr("href") || "" })).filter(x => /bid|solicitation|detail|view|external/i.test(`${x.text} ${x.href}`)).slice(0, 120);
  return { messages, rows, links, tail: compact(text.slice(-18000)) };
}

export async function GET() {
  const results: unknown[] = [];
  try {
    const response = await fetch(osp, { redirect: "follow", headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, cache: "no-store" });
    results.push({ name: "OSP", status: response.status, finalUrl: response.url, length: (await response.text()).length });
  } catch (error) { results.push({ name: "OSP", error: error instanceof Error ? error.message : String(error) }); }
  try {
    const first = await fetch(rivip, { redirect: "follow", headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, cache: "no-store" });
    const firstHtml = await first.text();
    const body = buildPost(firstHtml);
    const second = await fetch(first.url, { method: "POST", redirect: "manual", headers: { accept: "*/*", "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-microsoftajax": "Delta=true", "x-requested-with": "XMLHttpRequest", origin: "https://purchasing.ri.gov", referer: first.url, "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, body: body.toString(), cache: "no-store" });
    const text = await second.text();
    results.push({ name: "RIVIP", firstStatus: first.status, postStatus: second.status, postedEntities: body.getAll("ctl00$ContentPlaceHolder1$lstbox_ExBiddingEntities").length, length: text.length, hasDelta: /\|updatePanel\|/i.test(text), inspection: inspect(text) });
  } catch (error) { results.push({ name: "RIVIP", error: error instanceof Error ? error.message : String(error) }); }
  return NextResponse.json({ results });
}
