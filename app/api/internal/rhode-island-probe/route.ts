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
  $("#ctl00_ContentPlaceHolder1_lstbox_ExBiddingEntities option:selected").each((_, el) => body.append("ctl00$ContentPlaceHolder1$lstbox_ExBiddingEntities", $(el).attr("value") || compact($(el).text())));
  body.append("ctl00$ContentPlaceHolder1$lstbox_ExBidStatus", "Active(Scheduled)");
  body.set("ctl00$ContentPlaceHolder1$btn_ExSearch", "Search");
  return body;
}

function inspectDelta(text: string) {
  const $ = load(text);
  const candidates = $("table").toArray().map((table, i) => ({
    index: i,
    id: $(table).attr("id") || "",
    className: $(table).attr("class") || "",
    rows: $(table).find("tr").toArray().map((row, r) => ({
      row: r,
      cells: $(row).find("th,td").toArray().map(cell => compact($(cell).text())),
      links: $(row).find("a[href]").toArray().map(a => ({ text: compact($(a).text()), href: $(a).attr("href") || "" })),
    })).filter(row => row.cells.some(Boolean)),
  })).filter(table => table.rows.some(row => row.cells.some(cell => /solicitation|opening|entity|status|active|award|bid/i.test(cell))));
  const ids = $("[id]").toArray().map(el => ({ id: $(el).attr("id") || "", text: compact($(el).text()).slice(0, 500) })).filter(x => /grid|result|bid|solicitation/i.test(x.id)).slice(0, 80);
  const hrefs = $("a[href]").toArray().map(a => ({ text: compact($(a).text()), href: $(a).attr("href") || "" })).filter(x => /bid|solicitation|detail|view/i.test(`${x.text} ${x.href}`)).slice(0, 100);
  const keywords = ["Search Results", "Solicitation Number", "Opening Date", "Active(Scheduled)", "Bid Description", "No records", "No solicitations"];
  const snippets = keywords.map(keyword => {
    const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
    return idx >= 0 ? { keyword, snippet: compact(text.slice(Math.max(0, idx - 500), idx + 2500)) } : null;
  }).filter(Boolean);
  return { candidates, ids, hrefs, snippets };
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
    const second = await fetch(first.url, {
      method: "POST", redirect: "manual",
      headers: { accept: "*/*", "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-microsoftajax": "Delta=true", "x-requested-with": "XMLHttpRequest", origin: "https://purchasing.ri.gov", referer: first.url, "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
      body: buildPost(firstHtml).toString(), cache: "no-store",
    });
    const text = await second.text();
    results.push({ name: "RIVIP", firstStatus: first.status, postStatus: second.status, length: text.length, hasDelta: /\|updatePanel\|/i.test(text), inspection: inspectDelta(text) });
  } catch (error) { results.push({ name: "RIVIP", error: error instanceof Error ? error.message : String(error) }); }
  return NextResponse.json({ results });
}
