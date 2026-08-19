import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const osp = "https://webprocure.proactiscloud.com/wp-web-public/";
const searchUrl = "https://purchasing.ri.gov/bidding/ExternalBidSearch.aspx";
const listingUrl = "https://purchasing.ri.gov/bidding/ExternalBidListing.aspx";
const statuses = ["Active(Scheduled)", "Awarded", "Under Evaluation", "Canceled", "Tabulated"];
function compact(value: string) { return value.replace(/\s+/g, " ").trim(); }

function buildPost(html: string, selectedStatuses: string[]) {
  const $ = load(html);
  const body = new URLSearchParams();
  $("input[type=hidden][name]").each((_, el) => body.append($(el).attr("name")!, $(el).attr("value") || ""));
  body.delete("__ASYNCPOST");
  body.set("__EVENTTARGET", "");
  body.set("__EVENTARGUMENT", "");
  body.set("ctl00$ContentPlaceHolder1$ddl_ExBiddingGroup", "All External Bidding Groups");
  $("#ctl00_ContentPlaceHolder1_lstbox_ExBiddingEntities option").each((_, el) => body.append("ctl00$ContentPlaceHolder1$lstbox_ExBiddingEntities", $(el).attr("value") || compact($(el).text())));
  body.set("ctl00$ContentPlaceHolder1$txtbox_ExBidNumber", "");
  for (const status of selectedStatuses) body.append("ctl00$ContentPlaceHolder1$lstbox_ExBidStatus", status);
  body.set("ctl00$ContentPlaceHolder1$txtbox_ExKeywords", "");
  body.set("ctl00$ContentPlaceHolder1$txtbox_ExOpeningAfter", "");
  body.set("ctl00$ContentPlaceHolder1$txtbox_ExOpeningBefore", "");
  body.set("ctl00$ContentPlaceHolder1$btn_ExSearch", "Search");
  return body;
}

function summarize(html: string) {
  const $ = load(html);
  const bodyText = compact($("body").text());
  const count = bodyText.match(/Solicitations matching the entered criteria\s*:\s*(\d+)/i)?.[1] || null;
  const grid = $("#ctl00_ContentPlaceHolder1_GV_ExBidSearch");
  const rows = grid.find("tr").toArray().map((row, i) => ({ i, cells: $(row).find("th,td").toArray().map(cell => compact($(cell).text())), links: $(row).find("a[href]").toArray().map(a => ({ text: compact($(a).text()), href: $(a).attr("href") || "" })) }));
  return { count, gridRows: rows.length, rows: rows.slice(0, 30), body: bodyText.slice(0, 5000) };
}

async function submit(firstHtml: string, selectedStatuses: string[]) {
  const body = buildPost(firstHtml, selectedStatuses);
  const response = await fetch(listingUrl, { method: "POST", redirect: "manual", headers: { accept: "text/html,application/xhtml+xml", "content-type": "application/x-www-form-urlencoded", origin: "https://purchasing.ri.gov", referer: searchUrl, "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, body: body.toString(), cache: "no-store" });
  const html = await response.text();
  return { status: response.status, finalUrl: response.url, postedEntities: body.getAll("ctl00$ContentPlaceHolder1$lstbox_ExBiddingEntities").length, summary: summarize(html) };
}

export async function GET() {
  const results: unknown[] = [];
  try {
    const response = await fetch(osp, { redirect: "follow", headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, cache: "no-store" });
    results.push({ name: "OSP", status: response.status, finalUrl: response.url, length: (await response.text()).length });
  } catch (error) { results.push({ name: "OSP", error: error instanceof Error ? error.message : String(error) }); }
  try {
    const first = await fetch(searchUrl, { redirect: "follow", headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, cache: "no-store" });
    const firstHtml = await first.text();
    results.push({ name: "RIVIP", active: await submit(firstHtml, ["Active(Scheduled)"]), allStatuses: await submit(firstHtml, statuses) });
  } catch (error) { results.push({ name: "RIVIP", error: error instanceof Error ? error.message : String(error) }); }
  return NextResponse.json({ results });
}
