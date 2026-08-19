import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const osp = "https://webprocure.proactiscloud.com/wp-web-public/";
const rivip = "https://www.purchasing.ri.gov/bidding/ExternalBidSearch.aspx";

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function summarize(html: string) {
  const $ = load(html);
  const tables = $("table").toArray().map((table, tableIndex) => ({
    tableIndex,
    id: $(table).attr("id") || "",
    className: $(table).attr("class") || "",
    rows: $(table).find("tr").toArray().slice(0, 120).map((row, rowIndex) => ({
      rowIndex,
      cells: $(row).find("th,td").toArray().map(cell => compact($(cell).text())),
      links: $(row).find("a[href]").toArray().map(a => ({ text: compact($(a).text()), href: $(a).attr("href") || "" })),
    })),
  })).filter(table => table.rows.some(row => row.cells.some(cell => /solicitation|opening|status|agency|entity|bid|rfp|rfq/i.test(cell))));
  return { title: compact($("title").text()), tables };
}

function buildPost(html: string) {
  const $ = load(html);
  const body = new URLSearchParams();
  $("input[type=hidden][name]").each((_, el) => body.append($(el).attr("name")!, $(el).attr("value") || ""));
  const group = $("#ctl00_ContentPlaceHolder1_ddl_ExBiddingGroup");
  body.set(group.attr("name") || "ctl00$ContentPlaceHolder1$ddl_ExBiddingGroup", group.val()?.toString() || "All External Bidding Groups");
  const entities = $("#ctl00_ContentPlaceHolder1_lstbox_ExBiddingEntities option:selected");
  entities.each((_, el) => body.append("ctl00$ContentPlaceHolder1$lstbox_ExBiddingEntities", $(el).attr("value") || compact($(el).text())));
  body.append("ctl00$ContentPlaceHolder1$lstbox_ExBidStatus", "Active(Scheduled)");
  body.set("ctl00$ContentPlaceHolder1$btn_ExSearch", "Search");
  return body;
}

export async function GET() {
  const results: unknown[] = [];
  try {
    const response = await fetch(osp, { redirect: "follow", headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, cache: "no-store" });
    results.push({ name: "OSP", status: response.status, finalUrl: response.url, length: (await response.text()).length });
  } catch (error) {
    results.push({ name: "OSP", error: error instanceof Error ? error.message : String(error) });
  }

  try {
    const first = await fetch(rivip, { redirect: "follow", headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, cache: "no-store" });
    const firstHtml = await first.text();
    const post = buildPost(firstHtml);
    const second = await fetch(first.url, {
      method: "POST",
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "content-type": "application/x-www-form-urlencoded",
        referer: first.url,
        "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
      },
      body: post.toString(),
      cache: "no-store",
    });
    const secondHtml = await second.text();
    results.push({ name: "RIVIP", firstStatus: first.status, postStatus: second.status, finalUrl: second.url, length: secondHtml.length, summary: summarize(secondHtml) });
  } catch (error) {
    results.push({ name: "RIVIP", error: error instanceof Error ? error.message : String(error) });
  }

  return NextResponse.json({ results });
}
