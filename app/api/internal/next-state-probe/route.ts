import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const PAGE = "https://evp.nc.gov/solicitations/?status=0";
const SCRIPTS = [
  "https://gov.content.powerapps.us/resource/powerappsportal/dist/app.bundle-6a4b9a2a34.js",
  "https://gov.content.powerapps.us/resource/powerappsportal/dist/pcf.bundle-60440c37cb.js",
  "https://gov.content.powerapps.us/resource/powerappsportal/dist/preform.bundle-20160ed2b8.js",
];

function excerpts(source: string, patterns: string[]) {
  const output: Array<{ pattern: string; text: string }> = [];
  for (const pattern of patterns) {
    let from = 0;
    while (output.length < 30) {
      const index = source.indexOf(pattern, from);
      if (index < 0) break;
      output.push({ pattern, text: source.slice(Math.max(0, index - 2200), Math.min(source.length, index + 5200)).replace(/\s+/g, " ") });
      from = index + pattern.length;
    }
  }
  return output;
}

export async function GET() {
  const results = await Promise.allSettled(SCRIPTS.map(async url => {
    const response = await fetch(url, { headers: { accept: "application/javascript", referer: PAGE }, cache: "no-store" });
    const source = await response.text();
    return {
      url,
      status: response.status,
      length: source.length,
      hits: excerpts(source, ["getTokenDeferred", "__RequestVerificationToken", "ajaxSafePost", "antiforgery", "antiForgery", "RequestVerificationToken"]),
    };
  }));
  return NextResponse.json({ results: results.map(result => result.status === "fulfilled" ? result.value : { error: String(result.reason) }) });
}
