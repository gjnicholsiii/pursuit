import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const JS = "https://vendor.myfloridamarketplace.com/main.12e7aa9e28ddadbb00b9.js";

export async function GET() {
  try {
    const response = await fetch(JS, { cache: "no-store" });
    const js = await response.text();
    const contexts: string[] = [];
    for (const pattern of ["HTTP_CONFIG", "request.url", "clone({url", "clone({ url", "apiUrl", "baseUrl", "baseURL", "environment", "NO_TOKEN", "EP:", "intercept("]) {
      let i=0;
      while ((i=js.indexOf(pattern,i))>=0 && contexts.length<260) {
        contexts.push(js.slice(Math.max(0,i-650),Math.min(js.length,i+1500)));
        i += pattern.length;
      }
    }
    const urls=[...new Set((js.match(/https?:\\?\/\\?\/[^"'`\\\s)]+/g)||[]))];
    return NextResponse.json({ok:response.ok,status:response.status,length:js.length,urls,contexts});
  } catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500})}
}
