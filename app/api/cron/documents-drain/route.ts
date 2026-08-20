import { NextRequest, NextResponse } from "next/server";
import { GET as acquireDocuments } from "@/app/api/documents/acquire/route";
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

async function batch(path:string,count:number,worker:()=>Promise<Response>) {
  return Promise.all(Array.from({length:count},()=>capture(path,worker)));
}

export async function GET(request:NextRequest) {
  const secret=process.env.CRON_SECRET;
  if(!secret) return NextResponse.json({ok:false,error:"CRON_SECRET is not configured"},{status:503});
  if(request.headers.get("authorization")!==`Bearer ${secret}`) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});

  const results=[] as Array<Record<string,unknown>>;

  // Invoke workers in-process to avoid deployment-protection interception. The live
  // acquisition queue is currently stale/closed-opportunity work, while extraction
  // and analysis still contain active opportunity jobs, so prioritize downstream work.
  results.push(...await batch("/api/documents/acquire",1,()=>acquireDocuments(request)));
  results.push(...await batch("/api/documents/extract",8,()=>extractDocuments(request)));
  results.push(...await batch("/api/documents/analyze-all",5,()=>analyzeDocuments(request)));

  return NextResponse.json({ok:results.every(result=>result.ok!==false),steps:results.length,results});
}
