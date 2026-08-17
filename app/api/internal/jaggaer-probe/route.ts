import { NextRequest, NextResponse } from "next/server";
import { load } from "cheerio";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (request.headers.get("host") !== "pursuit-neon.vercel.app") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const url = "https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=DASIowa";
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, cache: "no-store" });
  const html = await response.text();
  const $ = load(html);
  const anchor = $('a[href*="app01.jaggaer.com/apps/Router/ViewSourcingEvent"]').first();
  const ancestors = [];
  let node = anchor;
  for (let depth = 0; depth < 10; depth += 1) {
    node = node.parent();
    if (!node.length) break;
    ancestors.push({
      depth: depth + 1,
      tag: node.get(0)?.tagName || "",
      id: node.attr("id") || "",
      className: node.attr("class") || "",
      text: node.text().replace(/\s+/g, " ").trim().slice(0, 2000),
    });
  }
  return NextResponse.json({ ok: true, title: anchor.text().replace(/\s+/g, " ").trim(), ancestors });
}
