import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const BASE = "https://hands.ehawaii.gov/hands/";
const MAIN = "main.9100414ce69cfc74a538.js";

export async function GET() {
  const response = await fetch(BASE + MAIN, {
    headers: {
      accept: "application/javascript,text/javascript,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    cache: "no-store",
    redirect: "follow",
  });
  const js = await response.text();
  const strings = [...js.matchAll(/["'`]([^"'`]{3,240})["'`]/g)].map(match => match[1]);
  const hits = strings.filter(value => /(opportun|solicit|bid|award|api|search|notice|hands|hiepro)/i.test(value));
  const unique = [...new Set(hits)].slice(0, 600);
  return NextResponse.json({ ok: response.ok, status: response.status, length: js.length, hits: unique });
}
