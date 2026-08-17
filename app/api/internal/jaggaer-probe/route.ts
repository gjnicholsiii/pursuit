import { NextRequest, NextResponse } from "next/server";
import { load } from "cheerio";
import { probeJaggaerStates } from "@/lib/sled/jaggaer";

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
  const anchors = $("a").toArray().map(anchor => ({
    text: $(anchor).text().replace(/\s+/g, " ").trim(),
    href: $(anchor).attr("href") || "",
  })).filter(item => item.text && /Router|SourcingEvent|Event|PDF|document/i.test(`${item.href} ${item.text}`)).slice(0, 40);

  const states = await probeJaggaerStates();
  return NextResponse.json({ ok: true, anchors, states });
}
