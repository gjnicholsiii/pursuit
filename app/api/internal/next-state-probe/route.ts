import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const PAGE = "https://evp.nc.gov/solicitations/?status=0";
const PCF = "https://gov.content.powerapps.us/resource/powerappsportal/dist/pcf.bundle-60440c37cb.js";
const APP = "https://gov.content.powerapps.us/resource/powerappsportal/dist/app.bundle-6a4b9a2a34.js";

function excerpts(source: string, patterns: string[]) {
  const output: Array<{ pattern: string; text: string }> = [];
  for (const pattern of patterns) {
    let from = 0;
    while (output.length < 20) {
      const index = source.indexOf(pattern, from);
      if (index < 0) break;
      output.push({ pattern, text: source.slice(Math.max(0, index - 2500), Math.min(source.length, index + 6500)).replace(/\s+/g, " ") });
      from = index + pattern.length;
    }
  }
  return output;
}

export async function GET() {
  const [pcfResponse, appResponse] = await Promise.all([
    fetch(PCF, { headers: { accept: "application/javascript", referer: PAGE }, cache: "no-store" }),
    fetch(APP, { headers: { accept: "application/javascript", referer: PAGE }, cache: "no-store" }),
  ]);
  const [pcf, app] = await Promise.all([pcfResponse.text(), appResponse.text()]);
  return NextResponse.json({
    pcf: excerpts(pcf, [
      "t={base64SecureConfiguration:n.Base64SecureConfiguration",
      "base64SecureConfiguration:n.Base64SecureConfiguration",
      "serviceUrlForGet",
    ]),
    app: excerpts(app, [
      "Base64SecureConfiguration",
      "base64SecureConfiguration",
      "_serviceUrl",
      "ajaxSafePost",
    ]),
  });
}
