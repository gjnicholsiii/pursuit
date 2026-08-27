import { NextRequest, NextResponse } from "next/server";
import { enrichSchoolContactsFast } from "@/lib/raven/school-contact-fast";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic="force-dynamic";
export const maxDuration=300;

export async function GET(request:NextRequest){
  const auth=requireInternalAuth(request); if(auth)return auth;
  try{
    const limit=Math.max(6,Math.min(Number(request.nextUrl.searchParams.get("limit")||24),40));
    const result=await enrichSchoolContactsFast("k12",limit);
    return NextResponse.json({ok:true,...result});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}
}
