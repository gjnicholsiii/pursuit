import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const CHUNK = "https://vendor.myfloridamarketplace.com/11.147be3f0dc8ea308788d.js";

export async function GET() {
  try {
    const response = await fetch(CHUNK, { cache: "no-store" });
    const js = await response.text();
    const contexts=[];
    for (const pattern of ["PUB_BID_SEARCH","PUB_BID_SEARCH_COUNT","http.post","http.get","searchBids","pageSize","pageNumber","sort"]) {
      let i=0;
      while ((i=js.toLowerCase().indexOf(pattern.toLowerCase(),i))>=0 && contexts.length<220) {
        contexts.push(js.slice(Math.max(0,i-420),Math.min(js.length,i+900)));
        i+=pattern.length;
      }
    }
    const strings=[...new Set((js.match(/["'`]([^"'`]{1,300})["'`]/g)||[]).map(v=>v.slice(1,-1)).filter(v=>/bid|advert|search|page|sort|date|agency|status|type/i.test(v)))].slice(0,900);
    return NextResponse.json({ok:response.ok,status:response.status,length:js.length,strings,contexts});
  } catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500})}
}
