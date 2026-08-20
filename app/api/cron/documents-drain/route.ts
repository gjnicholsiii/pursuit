import { NextRequest, NextResponse } from "next/server";
import { GET as extractDocuments } from "@/app/api/documents/extract/route";
import { GET as analyzeDocuments } from "@/app/api/documents/analyze-all/route";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

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

  // Cost-controlled manual drain only. Fresh acquisition is handled by the primary
  // document cron. Keep this route bounded so it cannot consume a five-minute Vercel run.
  const results=await Promise.all([
    capture("/api/documents/extract",()=>extractDocuments(request)),
    capture("/api/documents/analyze-all",()=>analyzeDocuments(request)),
  ]);

  return NextResponse.json({ok:results.every(result=>result.ok!==false),steps:results.length,results});
}
