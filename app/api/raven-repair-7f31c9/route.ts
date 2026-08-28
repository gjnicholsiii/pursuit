import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { enrichSchoolContactsFast } from "@/lib/raven/school-contact-fast";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(){
  try {
    const sql = getSql();
    await sql.query(`alter table raven_enrichment_runs add column if not exists pages_fetched integer not null default 0`);
    await sql.query(`alter table raven_enrichment_runs add column if not exists people_found integer not null default 0`);
    const k12 = await enrichSchoolContactsFast("k12", 1);
    const higherEd = await enrichSchoolContactsFast("higher_ed", 1);
    return NextResponse.json({ok:true,k12,higherEd});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("RAVEN_REPAIR_FAILURE", message);
    return NextResponse.json({ok:false,error:message},{status:500});
  }
}
