import { NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const osp = "https://webprocure.proactiscloud.com/wp-web-public/";
const rivip = "https://www.purchasing.ri.gov/bidding/ExternalBidSearch.aspx";

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildPost(html: string) {
  const $ = load(html);
  const body = new URLSearchParams();
  $("input[type=hidden][name]").each((_, el) => body.append($(el).attr("name")!, $(el).attr("value") || ""));
  body.set("ctl00$ContentPlaceHolder1$SM_ExternalbidSearch", "ctl00$ContentPlaceHolder1$updpan_ExternalbidSearch|ctl00$ContentPlaceHolder1$btn_ExSearch");
  body.set("__ASYNCPOST", "true");
  body.set("__EVENTTARGET", "");
  body.set("__EVENTARGUMENT", "");
  body.set("ctl00$ContentPlaceHolder1$ddl_ExBiddingGroup", "All External Bidding Groups");
  $("#ctl00_ContentPlaceHolder1_lstbox_ExBiddingEntities option:selected").each((_, el) => {
    body.append("ctl00$ContentPlaceHolder1$lstbox_ExBiddingEntities", $(el).attr("value") || compact($(el).text()));
  });
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
      redirect: "manual",
      headers: {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-microsoftajax": "Delta=true",
        "x-requested-with": "XMLHttpRequest",
        origin: "https://purchasing.ri.gov",
        referer: first.url,
        "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
      },
      body: post.toString(),
      cache: "no-store",
    });
    const text = await second.text();
    results.push({
      name: "RIVIP",
      firstStatus: first.status,
      postStatus: second.status,
      finalUrl: second.url,
      location: second.headers.get("location"),
      contentType: second.headers.get("content-type"),
      length: text.length,
      hasDelta: /^\d+\|/.test(text) || /\|updatePanel\|/i.test(text),
      hasSolicitationResults: /solicitation number|opening date|active\(scheduled\)|bid description/i.test(text),
      sample: text.slice(0, 20000),
    });
  } catch (error) {
    results.push({ name: "RIVIP", error: error instanceof Error ? error.message : String(error) });
  }

  return NextResponse.json({ results });
}
