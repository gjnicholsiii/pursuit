import { NextResponse } from "next/server";
import { load } from "cheerio";

const URL = "https://supplier.sok.ks.gov/psc/sokfsprdsup/SUPPLIER/ERP/c/SCP_PUBLIC_MENU_FL.SCP_PUB_BID_CMP_FL.GBL?page=SCP_PUB_BIDLIST_FL";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const response = await fetch(URL, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    redirect: "follow",
    cache: "no-store",
  });
  const html = await response.text();
  const $ = load(html);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const tableRows = $("table tr").toArray().slice(0, 12).map(row => $(row).text().replace(/\s+/g, " ").trim()).filter(Boolean);
  const evtIndex = html.search(/EVT\d+/i);
  const eventExcerpt = evtIndex >= 0 ? html.slice(Math.max(0, evtIndex - 800), evtIndex + 1800) : null;
  const scripts = $("script").toArray().map(node => $(node).html() || "").filter(value => /EVT\d+|SCP_PUB_BID/i.test(value)).slice(0, 3).map(value => value.slice(0, 3000));
  return NextResponse.json({
    status: response.status,
    finalUrl: response.url,
    htmlLength: html.length,
    title: $("title").text().trim(),
    tables: $("table").length,
    rowCount: $("table tr").length,
    bodyText: bodyText.slice(0, 6000),
    tableRows,
    eventExcerpt,
    scripts,
  });
}
