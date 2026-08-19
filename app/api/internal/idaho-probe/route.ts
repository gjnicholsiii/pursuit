import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const START_URL = "https://sms-idaho-prd.tam.inforgov.com/fsm/SupplyManagementSupplier/page/XiSupplyManagementSupplierPage?csk.SupplierGroup=LUMA";

export async function GET() {
  const hops:any[]=[];
  let url=START_URL;
  for (let i=0;i<10;i++) {
    try {
      const r=await fetch(url,{redirect:"manual",headers:{accept:"text/html,application/xhtml+xml,*/*;q=0.8","user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0"},cache:"no-store"});
      const text=await r.text();
      hops.push({url,status:r.status,location:r.headers.get("location"),contentType:r.headers.get("content-type"),cookies:r.headers.get("set-cookie"),sample:text.slice(0,2500)});
      const loc=r.headers.get("location");
      if (!loc || r.status < 300 || r.status >= 400) break;
      url=new globalThis.URL(loc,url).toString();
    } catch (e) {
      hops.push({url,error:e instanceof Error?e.message:String(e)});
      break;
    }
  }
  return NextResponse.json({hops});
}
