import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const pageUrl = "https://houstonisd.ionwave.net/SourcingEvents.aspx?SourceType=1";
  const r = await fetch(pageUrl, { cache:"no-store", headers:{"user-agent":"Mozilla/5.0"} });
  const html = await r.text();
  const needles = ["PostBackFunction", "__doPostBack", "ClientSettings"];
  const out: Record<string,string[]> = {};
  for (const needle of needles) {
    out[needle] = [];
    let pos = 0;
    while (out[needle].length < 8) {
      const at = html.indexOf(needle, pos);
      if (at < 0) break;
      out[needle].push(html.slice(Math.max(0,at-700), at+1800));
      pos = at + needle.length;
    }
  }
  return NextResponse.json({ status:r.status, out });
}
