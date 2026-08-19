import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const base = "https://financials.ok.gov";
const publicPath = "/psc/SOKLFP1DS/SUPPLIER/ERP/c/SCP_PUBLIC_MENU_FL.SCP_PUB_BID_CMP_FL.GBL";

function cookies(setCookie: string | null) {
  if (!setCookie) return "";
  return setCookie.split(/,(?=[^;,]+=)/).map(part => part.split(";")[0].trim()).filter(Boolean).join("; ");
}

export async function GET() {
  const first = await fetch(base + publicPath, {
    redirect: "manual",
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    cache: "no-store",
  });
  const c1 = cookies(first.headers.get("set-cookie"));
  const location1 = first.headers.get("location");
  let second: Response | null = null;
  let secondText = "";
  let c2 = c1;
  if (location1) {
    second = await fetch(new URL(location1, base).toString(), {
      redirect: "manual",
      headers: { accept: "text/html,application/xhtml+xml", cookie: c1, "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
      cache: "no-store",
    });
    secondText = await second.text();
    c2 = [c1, cookies(second.headers.get("set-cookie"))].filter(Boolean).join("; ");
  }
  const third = await fetch(base + publicPath, {
    redirect: "manual",
    headers: { accept: "text/html,application/xhtml+xml", cookie: c2, referer: base + (location1 || publicPath), "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" },
    cache: "no-store",
  });
  const thirdText = await third.text();
  return NextResponse.json({
    first: { status: first.status, location: location1, cookies: c1 },
    second: second ? { status: second.status, location: second.headers.get("location"), cookies: c2, len: secondText.length, sample: secondText.slice(0, 4000) } : null,
    third: { status: third.status, location: third.headers.get("location"), len: thirdText.length, hasBidComponent: /SCP_PUB_BID_CMP_FL|Bidding Opportunities|Search Events|Event ID/i.test(thirdText), hasLogin: /sign in|userid|pwd/i.test(thirdText), sample: thirdText.slice(0, 12000) },
  });
}
