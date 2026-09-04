import { NextRequest, NextResponse } from "next/server";
import { enrichSchoolContactsFast } from "@/lib/raven/school-contact-fast";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic="force-dynamic";
export const maxDuration=300;

export async function GET(request:NextRequest){
  const auth=requireInternalAuth(request); if(auth)return auth;
  try{
    const limit=Math.max(12,Math.min(Number(request.nextUrl.searchParams.get("limit")||72),96));
    const result=await enrichSchoolContactsFast("k12",limit);
    console.log("RAVEN_SCHOOLS_FAST",result);
    return NextResponse.json({ok:true,...result});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    console.error("RAVEN_SCHOOLS_FAST_ERROR",message);
    return NextResponse.json({ok:false,error:message},{status:500});
  }
}
