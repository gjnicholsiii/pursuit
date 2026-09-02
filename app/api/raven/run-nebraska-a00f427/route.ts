import * as cheerio from "cheerio";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://educdirsrc.education.ne.gov/QuickDisplay.aspx?code=pda&sort=name";

function clean(value:string){return value.replace(/\u00a0/g," ").replace(/\s+/g," ").trim();}
function validEmail(value:string){return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);}

export async function GET(){
  const beforeSql=getSql();
  const beforeRows=await beforeSql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[];
  const res=await fetch(SOURCE,{cache:"no-store",headers:{"user-agent":"Mozilla/5.0 (compatible; Pursuit-Raven/3.0; authoritative-public-directory)",accept:"text/html,application/xhtml+xml"}});
  if(!res.ok)return NextResponse.json({ok:false,error:`Nebraska NDE HTTP ${res.status}`},{status:502});
  const $=cheerio.load(await res.text());
  const roster:Array<{district:string;fullName:string;email:string;phone:string}>=[];
  $("tr").each((_,element)=>{
    const cells=$(element).find("th,td").map((__,cell)=>clean($(cell).text())).get();
    const agencyIndex=cells.findIndex(cell=>/^\d{2}-\d{4}-\d{3}$/.test(cell));
    if(agencyIndex<1||agencyIndex+1>=cells.length)return;
    const fullName=clean(cells[agencyIndex-1]).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.)\s+/i,"");
    const district=clean(cells[agencyIndex+1]);
    const email=cells.find(cell=>validEmail(cell))||"";
    const phone=cells.find(cell=>/^\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}$/.test(cell))||"";
    if(!fullName||!district||(!email&&!phone)||/administrator/i.test(fullName))return;
    roster.push({district,fullName,email,phone});
  });
  const deduped=[...new Map(roster.map(r=>[r.district.toLowerCase(),r])).values()];
  let attempted=0,matched=0,filled=0;
  for(const row of deduped){
    attempted++;
    const districtKey=row.district.replace(/\s+(Public|Community|Consolidated)?\s*Schools?$/i,"").replace(/\s+School District$/i,"").trim();
    const updated=await beforeSql.query(`with target as (select c.id from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code='NE' and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing' and (lower(coalesce(a.canonical_name,''))=lower($1) or lower(coalesce(a.canonical_name,'')) like '%'||lower($2)||'%') order by case when lower(coalesce(a.canonical_name,''))=lower($1) then 0 else 1 end limit 1) update raven_state_contacts c set full_name=$3,title='Superintendent',email=nullif($4,''),phone=nullif($5,''),source_url=$6,verification_status='candidate',evidence_note='Reachable superintendent from authoritative Nebraska Department of Education directory; email or phone published by NDE; awaiting strict live revalidation.',updated_at=now() from target t where c.id=t.id returning c.id`,[row.district,districtKey,row.fullName,row.email,row.phone,SOURCE]) as any[];
    if(updated.length){matched++;filled+=updated.length;}
  }
  const afterRows=await beforeSql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[];
  return NextResponse.json({ok:true,source:SOURCE,fetched:deduped.length,attempted,matched,filled,before:beforeRows[0],after:afterRows[0]});
}
