import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const bundleUrl = "https://postingboard.esmsolutions.com/ng/lib/main.3de34ba34fb9f04d.js";

function pieces(text: string, needle: string) {
  const out: string[] = [];
  let at = 0;
  while ((at = text.indexOf(needle, at)) >= 0 && out.length < 30) {
    out.push(text.slice(Math.max(0, at - 300), Math.min(text.length, at + 700)).replace(/\s+/g, " "));
    at += needle.length;
  }
  return out;
}

export async function GET() {
  const response = await fetch(bundleUrl, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
  const text = await response.text();
  return NextResponse.json({
    status: response.status,
    length: text.length,
    api: pieces(text, "postingboard.esmsolutions.com/api/"),
    events: pieces(text, "/events"),
    entities: pieces(text, "/entities"),
    getEvents: pieces(text, "getEvents"),
  });
}
