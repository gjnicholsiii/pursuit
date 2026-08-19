import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const BASE = "https://vendor.myfloridamarketplace.com/";
const JS = "https://vendor.myfloridamarketplace.com/main.12e7aa9e28ddadbb00b9.js";

export async function GET() {
  try {
    const response = await fetch(JS, { headers: { accept: "application/javascript,*/*;q=0.8", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" }, cache: "no-store" });
    const js = await response.text();
    const quoted = js.match(/["'`]([^"'`]{1,260})["'`]/g) || [];
    const strings = [...new Set(quoted.map(v => v.slice(1,-1)).filter(v => /api|bid|solicit|advert|opportun|search|vendor/i.test(v)))].slice(0,500);
    const contexts = [];
    for (const pattern of ["solicit","bid","advert","opportun","api/"]) {
      let i = 0;
      while ((i = js.toLowerCase().indexOf(pattern, i)) >= 0 && contexts.length < 120) {
        contexts.push(js.slice(Math.max(0,i-220), Math.min(js.length,i+420)));
        i += pattern.length;
      }
    }
    return NextResponse.json({ok:response.ok,status:response.status,length:js.length,strings,contexts});
  } catch (error) {
    return NextResponse.json({ok:false,error:error instanceof Error ? error.message : String(error)}, {status:500});
  }
}
