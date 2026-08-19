import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const URL = "https://hands.ehawaii.gov/hands/welcome";

export async function GET() {
  const response = await fetch(URL, {
    headers: {
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
    },
    cache: "no-store",
    redirect: "follow",
  });
  const html = await response.text();
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(match => match[1]);
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map(match => match[1]).filter(Boolean);
  const forms = [...html.matchAll(/<form[^>]+action=["']([^"']+)["']/gi)].map(match => match[1]);
  return NextResponse.json({
    ok: response.ok,
    status: response.status,
    url: response.url,
    length: html.length,
    scripts,
    forms,
    links: links.slice(0, 200),
    head: html.slice(0, 20000),
  });
}
