import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const ORIGIN = "https://www.ms.gov";
const TARGET = `${ORIGIN}/dfa/contract_bid_search/Bid?autoloadGrid=true`;
const BUNDLE = `${ORIGIN}/dfa/contract_bid_search/bundles/scripts/bid?v=6cRAHBhjQ8myKPsbarDMb-VP23hS0BCpTVPMnM2gg5o1`;

export async function GET() {
  try {
    const [pageRes,bundleRes] = await Promise.all([
      fetch(TARGET,{headers:{accept:"text/html,application/xhtml+xml,*/*;q=0.8","user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0"},cache:"no-store"}),
      fetch(BUNDLE,{headers:{accept:"application/javascript,*/*;q=0.8","user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0"},cache:"no-store"}),
    ]);
    const page=await pageRes.text();
    const bundle=await bundleRes.text();
    const idx=bundle.indexOf("BidData");
    return NextResponse.json({pageStatus:pageRes.status,bundleStatus:bundleRes.status,bundleLength:bundle.length,bidDataContext:idx>=0?bundle.slice(Math.max(0,idx-6000),idx+12000):null,allUrls:[...bundle.matchAll(/["']([^"']*(?:BidData|BidDetailData|\/Bid\/Details|contract_bid_search\/Search)[^"']*)["']/g)].map(m=>m[1]).slice(0,50)});
  } catch (e) { return NextResponse.json({error:e instanceof Error?e.message:String(e)},{status:500}); }
}
