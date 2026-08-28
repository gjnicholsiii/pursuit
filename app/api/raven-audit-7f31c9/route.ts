import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { resolveK12OfficialSites } from "@/lib/raven/k12-official-site";
import { enrichSchoolContactsFast } from "@/lib/raven/school-contact-fast";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(){
  try {
    const sql=getSql();
    const before=await sql.query(`select a.agency_type,count(distinct a.id)::int organizations,count(rp.id)::int people,count(rp.id) filter(where rp.email is not null)::int with_email from agencies a left join raven_people rp on rp.agency_id=a.id where a.agency_type in ('k12','higher_ed') group by a.agency_type order by a.agency_type`);
    const identity=await resolveK12OfficialSites(24);
    const k12=await enrichSchoolContactsFast('k12',6);
    const higherEd=await enrichSchoolContactsFast('higher_ed',6);
    const after=await sql.query(`select a.agency_type,count(distinct a.id)::int organizations,count(rp.id)::int people,count(rp.id) filter(where rp.email is not null)::int with_email from agencies a left join raven_people rp on rp.agency_id=a.id where a.agency_type in ('k12','higher_ed') group by a.agency_type order by a.agency_type`);
    return NextResponse.json({ok:true,before,identity,k12,higherEd,after});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}
}
