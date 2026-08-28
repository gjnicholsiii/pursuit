import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(){
  try {
    const sql=getSql();
    const k12=await sql.query(`select a.canonical_name,a.state_code,a.website,(select count(*)::int from raven_people rp where rp.agency_id=a.id) people from agencies a where a.agency_type='k12' and a.website is not null and a.website<>'' order by people asc,a.canonical_name limit 12`);
    const higherEd=await sql.query(`select a.canonical_name,a.state_code,a.website,(select count(*)::int from raven_people rp where rp.agency_id=a.id) people from agencies a where a.agency_type in ('higher_ed','education') and a.website is not null and a.website<>'' order by people asc,a.canonical_name limit 12`);
    return NextResponse.json({ok:true,k12,higherEd});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}
}
