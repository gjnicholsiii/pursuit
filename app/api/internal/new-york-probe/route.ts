import { NextResponse } from "next/server";
import { load } from "cheerio";

const URL = "https://www.nyscr.ny.gov/Ads/Search?DateFilter=All&DivisionId=&GovernmentId=&Keyword=&Skip=0&Sort=-DateIssued&Status=Open&SubcontractId=&Top=25&UseBookmarks=&UseNotifications=&UseProfile=";

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
  const crNodes = $("body *").filter((_, node) => /^\s*CR#:\s*$/i.test($(node).text())).slice(0, 3).toArray();
  const samples = crNodes.map(node => {
    const element = $(node);
    const fieldRow = element.parent();
    const detailColumn = fieldRow.parent();
    const cardBody = detailColumn.parent();
    const card = cardBody.parent();
    return {
      fieldRowClass: fieldRow.attr("class") || null,
      detailColumnClass: detailColumn.attr("class") || null,
      cardBodyTag: (cardBody.get(0) as any)?.tagName || (cardBody.get(0) as any)?.name || null,
      cardBodyClass: cardBody.attr("class") || null,
      cardBodyText: cardBody.text().replace(/\s+/g, " ").trim().slice(0, 5000),
      cardTag: (card.get(0) as any)?.tagName || (card.get(0) as any)?.name || null,
      cardClass: card.attr("class") || null,
      cardText: card.text().replace(/\s+/g, " ").trim().slice(0, 7000),
      cardHtml: card.html()?.slice(0, 12000) || null,
      links: card.find("a").toArray().slice(0, 10).map(anchor => ({ text: $(anchor).text().replace(/\s+/g, " ").trim(), href: $(anchor).attr("href") || null })),
    };
  });
  return NextResponse.json({
    status: response.status,
    finalUrl: response.url,
    htmlLength: html.length,
    title: $("title").text().trim(),
    crNodeCount: $("body *").filter((_, node) => /^\s*CR#:\s*$/i.test($(node).text())).length,
    samples,
  });
}
