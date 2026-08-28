import { NextResponse } from "next/server";
import { enrichSchoolContactsFast } from "@/lib/raven/school-contact-fast";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(){
  try {
    const result = await enrichSchoolContactsFast("k12", 1);
    return NextResponse.json({ok:true,...result});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("RAVEN_KICK_FAILURE", message);
    return NextResponse.json({ok:false,error:message},{status:500});
  }
}
