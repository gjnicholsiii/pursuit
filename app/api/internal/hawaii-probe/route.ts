import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const BASE = "https://hands.ehawaii.gov/hands/";
const MAIN = "main.9100414ce69cfc74a538.js";

export async function GET() {
  const response = await fetch(BASE + MAIN, {
    headers: { accept: "application/javascript,text/javascript,*/*;q=0.8", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    cache: "no-store",
    redirect: "follow",
  });
  const js = await response.text();
  const urls = [...new Set([...js.matchAll(/https?:\\?\/\\?\/[^"'`\\s)]+/g)].map(m => m[0]))].slice(0, 200);
  const apiPaths = [...new Set([...js.matchAll(/["'`]([^"'`]*(?:api|opportunit|solicitation|award|search)[^"'`]*)["'`]/gi)].map(m => m[1]))].filter(v => v.length < 300).slice(0, 1000);
  const needles = ["handsSolicitationsCriteria", "ApiUrl", "this.Api=", "opportunities", "opportunity-public", "searchCriteria"];
  const contexts = needles.map(needle => {
    const index = js.indexOf(needle);
    return { needle, index, context: index >= 0 ? js.slice(Math.max(0, index - 1200), index + 2500) : null };
  });
  return NextResponse.json({ ok: response.ok, status: response.status, length: js.length, urls, apiPaths, contexts });
}
