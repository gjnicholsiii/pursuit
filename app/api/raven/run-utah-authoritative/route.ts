import * as cheerio from "cheerio";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://schools.utah.gov/schooldistricts";
function clean(v:string){return v.replace(/\u00a0/g," ").replace(/\s+/g," ").trim();}
function validEmail(v:string){return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(v);}

export async function GET(){
  const sql=getSql();
  const before=(await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  const res=await fetch(SOURCE,{cache:"no-store",redirect:"follow",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/3.0; authoritative-public-directory)",accept:"text/html,application/xhtml+xml"}});
  if(!res.ok)return NextResponse.json({ok:false,error:`Utah USBE HTTP ${res.status}`,before},{status:502});
  const $=cheerio.load(await res.text());
  const roster:Array<{district:string;fullName:string;email:string;phone:string}>=[];
  $("tr").each((_,el)=>{
    const cells=$(el).find("th,td").map((__,c)=>clean($(c).text())).get();
    if(cells.length<13)return;
    const district=cells[0]||"";
    const fullName=(cells[9]||"").replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.)\s+/i,"");
    let email=cells[12]||cells.find(validEmail)||"";
    if(!validEmail(email))email="";
    const phone=cells[16]||cells.find(c=>/^\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}$/.test(c))||"";
    if(!district||!fullName||(!email&&!phone)||/district\s*$/i.test(fullName))return;
    roster.push({district,fullName,email,phone});
  });
  const deduped=[...new Map(roster.map(r=>[r.district.toLowerCase(),r])).values()];
  let attempted=0,matched=0,filled=0;
  for(const row of deduped){
    attempted++;
    const key=row.district.replace(/\s+(School )?District$/i,"").trim();
    const updated=await sql.query(`with target as (select c.id from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='UT' and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' and (lower(coalesce(a.canonical_name,''))=lower($1) or lower(coalesce(a.canonical_name,'')) like '%'||lower($2)||'%' or lower(coalesce(c.county,''))=lower($2)) order by case when lower(coalesce(a.canonical_name,''))=lower($1) then 0 when lower(coalesce(c.county,''))=lower($2) then 1 else 2 end limit 1) update raven_state_contacts c set full_name=$3,title='Superintendent',email=nullif($4,''),phone=nullif($5,''),source_url=$6,verification_status='candidate',evidence_note='Reachable superintendent from authoritative Utah State Board of Education district directory; email or phone published by USBE; awaiting strict live revalidation.',updated_at=now() from target t where c.id=t.id returning c.id`,[row.district,key,row.fullName,row.email,row.phone,SOURCE]) as any[];
    if(updated.length){matched++;filled+=updated.length;}
  }
  const after=(await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[])[0];
  return NextResponse.json({ok:true,source:SOURCE,fetched:deduped.length,attempted,matched,filled,before,after});
}
