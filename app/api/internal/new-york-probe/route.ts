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
  const crNodes = $("body *").filter((_, node) => /^\s*CR#:\s*$/i.test($(node).text())).slice(0, 5).toArray();
  const samples = crNodes.map(node => {
    const element = $(node);
    const parent = element.parent();
    const grandparent = parent.parent();
    return {
      tag: (node as any).tagName || (node as any).name || null,
      className: element.attr("class") || null,
      parentTag: (parent.get(0) as any)?.tagName || (parent.get(0) as any)?.name || null,
      parentClass: parent.attr("class") || null,
      parentText: parent.text().replace(/\s+/g, " ").trim().slice(0, 1800),
      grandparentTag: (grandparent.get(0) as any)?.tagName || (grandparent.get(0) as any)?.name || null,
      grandparentClass: grandparent.attr("class") || null,
      grandparentText: grandparent.text().replace(/\s+/g, " ").trim().slice(0, 3000),
      parentHtml: parent.html()?.slice(0, 5000) || null,
    };
  });
  const body = $("body").text().replace(/\s+/g, " ").trim();
  return NextResponse.json({
    status: response.status,
    finalUrl: response.url,
    htmlLength: html.length,
    title: $("title").text().trim(),
    crNodeCount: $("body *").filter((_, node) => /^\s*CR#:\s*$/i.test($(node).text())).length,
    samples,
    bodyStart: body.slice(0, 3000),
  });
}
