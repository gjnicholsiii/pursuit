import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { enrichK12Batch } from "@/lib/raven/k12-enrichment";
import { resolveK12OfficialSites } from "@/lib/raven/k12-official-site";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(){
  try {
    const sql=getSql();
    const before=await sql.query(`select count(*)::int people,count(*) filter(where email is not null)::int with_email,count(distinct agency_id)::int organizations from raven_people rp join agencies a on a.id=rp.agency_id where a.agency_type='k12'`);
    const identity=await resolveK12OfficialSites(120);
    const result=await enrichK12Batch(9);
    const after=await sql.query(`select count(*)::int people,count(*) filter(where email is not null)::int with_email,count(distinct agency_id)::int organizations from raven_people rp join agencies a on a.id=rp.agency_id where a.agency_type='k12'`);
    return NextResponse.json({ok:true,before:before[0],identity:{attempted:identity.attempted,resolved:identity.resolved,failed:identity.failed},result,after:after[0]});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}
}
