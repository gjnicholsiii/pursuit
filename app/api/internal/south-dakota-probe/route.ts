import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const url = "https://www.sd.gov/api/now/sp/page?id=kb_article_view&sysparm_article=KB0044739";

function walk(value: unknown, path = "$", out: unknown[] = []) {
  if (out.length >= 100) return out;
  if (typeof value === "string") {
    if (/Campus, Windows and Doors Replacement|Veterans Cemetery|Advertisements for Bids|W2526--02XSWMR|N1826--06X|8\/20\/26|08\/20\/26/i.test(value)) {
      out.push({ path, length:value.length, sample:value.slice(0,20000) });
    }
  } else if (Array.isArray(value)) {
    value.forEach((item,i)=>walk(item,`${path}[${i}]`,out));
  } else if (value && typeof value === "object") {
    for (const [key,item] of Object.entries(value as Record<string,unknown>)) walk(item,`${path}.${key}`,out);
  }
  return out;
}

export async function GET() {
  const r = await fetch(url, { cache:"no-store", headers:{ accept:"application/json", "user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
  const payload = await r.json();
  return NextResponse.json({ status:r.status, matches:walk(payload) });
}
