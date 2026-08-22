import { NextRequest, NextResponse } from "next/server";
import { GET as extractDocuments } from "@/app/api/documents/extract/route";
import { GET as analyzeDocuments } from "@/app/api/documents/analyze-all/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function capture(path:string, worker:()=>Promise<Response>) {
  try {
    const response=await worker();
    let body:unknown=null;
    try { body=await response.json(); } catch { body={status:response.status}; }
    return {path,status:response.status,ok:response.ok,body};
  } catch (error) {
    return {path,status:500,ok:false,body:{error:error instanceof Error?error.message:"worker_failed"}};
  }
}

export async function GET(request:NextRequest) {
  const secret=process.env.CRON_SECRET;
  if(!secret) return NextResponse.json({ok:false,error:"CRON_SECRET is not configured"},{status:503});
  if(request.headers.get("authorization")!==`Bearer ${secret}`) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  // Drain the memory-heavy PDF extraction stage first, then analysis. Running both
  // simultaneously competes for the same function memory and previously made the
  // extraction worker's 300-second budget ineffective behind this 90-second parent.
  const results=[] as Array<{path:string;status:number;ok:boolean;body:unknown}>;
  results.push(await capture("/api/documents/extract",()=>extractDocuments(request)));
  results.push(await capture("/api/documents/analyze-all",()=>analyzeDocuments(request)));

  return NextResponse.json({ok:results.every(result=>result.ok!==false),steps:results.length,results});
}
