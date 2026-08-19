import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const BASE = "https://vendor.myfloridamarketplace.com/";

export async function GET() {
  try {
    const index = await fetch(BASE, { cache: "no-store" }).then(r=>r.text());
    const runtimeName = index.match(/src="(runtime\.[^"]+\.js)"/)?.[1];
    if (!runtimeName) throw new Error("runtime bundle not found");
    const runtime = await fetch(BASE + runtimeName, { cache: "no-store" }).then(r=>r.text());
    const mappings = [...new Set((runtime.match(/18[^,;}]{0,160}/g) || []))].slice(0,80);
    const jsNames = [...new Set((runtime.match(/[A-Za-z0-9._-]+\.js/g) || []))].slice(0,300);
    return NextResponse.json({ok:true,runtimeName,runtimeLength:runtime.length,mappings,jsNames,runtime});
  } catch (error) {
    return NextResponse.json({ok:false,error:error instanceof Error ? error.message : String(error)}, {status:500});
  }
}
