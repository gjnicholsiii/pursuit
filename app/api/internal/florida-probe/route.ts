import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const CHUNK = "https://vendor.myfloridamarketplace.com/18.6aaad639f698801615ce.js";

export async function GET() {
  try {
    const response = await fetch(CHUNK, { cache: "no-store" });
    const js = await response.text();
    const quoted = js.match(/["'`]([^"'`]{1,300})["'`]/g) || [];
    const strings = [...new Set(quoted.map(v=>v.slice(1,-1)).filter(v=>/api|bid|solicit|advert|search|agency|status|page|sort|publish/i.test(v)))].slice(0,700);
    const contexts=[];
    for (const pattern of ["http.get","http.post","solicit","advert","search","api/"]) {
      let i=0;
      while ((i=js.toLowerCase().indexOf(pattern.toLowerCase(),i))>=0 && contexts.length<180) {
        contexts.push(js.slice(Math.max(0,i-260),Math.min(js.length,i+520)));
        i+=pattern.length;
      }
    }
    return NextResponse.json({ok:response.ok,status:response.status,length:js.length,strings,contexts});
  } catch (error) {
    return NextResponse.json({ok:false,error:error instanceof Error ? error.message : String(error)}, {status:500});
  }
}
