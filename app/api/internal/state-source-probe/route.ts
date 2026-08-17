import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const targets = [
  { key: "missouri", url: "https://missouribuys.mo.gov/bid-board/movers" },
  { key: "missouri_oracle", url: "https://ewqg.fa.us8.oraclecloud.com/fscmUI/faces/NegotiationAbstracts" },
  { key: "kentucky", url: "https://vss.ky.gov/vssprod-ext/Advantage4" },
  { key: "ohio", url: "https://ohiobuys.ohio.gov/" },
  { key: "ohio_example", url: "https://ohiobuys.ohio.gov/page.aspx/en/bpm/process_manage_extranet/55251" },
];

function pick(text: string, pattern: RegExp, limit = 60) {
  return [...text.matchAll(pattern)].slice(0, limit).map(match => match[0]);
}

export async function GET(request: NextRequest) {
  if (request.headers.get("host") !== "pursuit-neon.vercel.app") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const results = [];
  for (const target of targets) {
    try {
      const response = await fetch(target.url, {
        redirect: "follow",
        cache: "no-store",
        headers: {
          accept: "text/html,application/xhtml+xml,application/json",
          "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
        },
      });
      const body = await response.text();
      results.push({
        key: target.key,
        requested: target.url,
        finalUrl: response.url,
        status: response.status,
        contentType: response.headers.get("content-type"),
        size: body.length,
        iframes: pick(body, /<iframe\b[^>]*>/gi, 20),
        forms: pick(body, /<form\b[^>]*>/gi, 20),
        scripts: pick(body, /<script\b[^>]*src=["'][^"']+["'][^>]*>/gi, 60),
        urls: [...new Set(pick(body, /https?:\\?\/\\?\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%\\-]+/gi, 100))],
        relevant: body
          .split(/\r?\n/)
          .filter(line => /solicitation|negotiation|abstract|bid|opportunit|api|public|search/i.test(line))
          .slice(0, 80)
          .map(line => line.slice(0, 1500)),
        head: body.slice(0, 5000),
      });
    } catch (error) {
      results.push({ key: target.key, requested: target.url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
