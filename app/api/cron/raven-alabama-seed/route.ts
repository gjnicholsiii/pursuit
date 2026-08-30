import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const rows = [
  {county:"Baldwin", role_key:"superintendent", full_name:"Marty McRae", title:"Superintendent", email:null, phone:"251-937-0306", source_url:"https://www.bcbe.org/", note:"Current BCBE homepage identifies Marty McRae as superintendent."},
  {county:"Baldwin", role_key:"assistant_superintendent", full_name:"Joe Sharp", title:"Assistant Superintendent, Secondary Education", email:null, phone:"251-937-0306", source_url:"https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-secondary-education", note:"Official BCBE senior staff page."},
  {county:"Baldwin", role_key:"it_director", full_name:"David Besancon", title:"Assistant Superintendent, Educational Technology", email:null, phone:"251-937-0306", source_url:"https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-educational-technology", note:"Official BCBE technology executive; mapped to IT Director role as closest true district technology executive."},
  {county:"Baldwin", role_key:"school_board", full_name:"Ken Bradley", title:"Board Member, District 1", email:null, phone:"251-406-8258", source_url:"https://www.bcbe.org/board-of-education/bcbe-board-members", note:"Official BCBE board page."},
  {county:"Baldwin", role_key:"school_board", full_name:"Andrea Lindsey", title:"Board Member, District 2", email:null, phone:"251-586-4274", source_url:"https://www.bcbe.org/board-of-education/bcbe-board-members", note:"Official BCBE board page."},
  {county:"Baldwin", role_key:"school_board", full_name:"Tony Myrick", title:"Board President, District 3", email:null, phone:null, source_url:"https://www.bcbe.org/board-of-education/bcbe-board-members", note:"Official BCBE board page."},
  {county:"Baldwin", role_key:"school_board", full_name:"Rondi Kirby", title:"Board Member, District 4", email:null, phone:null, source_url:"https://www.bcbe.org/board-of-education/bcbe-board-members", note:"Official BCBE board page."},
  {county:"Baldwin", role_key:"school_board", full_name:"Jason P. Woerner", title:"Board Member, District 5", email:null, phone:"251-232-0038", source_url:"https://www.bcbe.org/board-of-education/bcbe-board-members", note:"Official BCBE board page."},
  {county:"Baldwin", role_key:"school_board", full_name:"Cecil Christenberry", title:"Board Member, District 6", email:null, phone:null, source_url:"https://www.bcbe.org/board-of-education/bcbe-board-members", note:"Official BCBE board page."},
  {county:"Baldwin", role_key:"school_board", full_name:"April Bradley", title:"Board Vice President, District 7", email:null, phone:null, source_url:"https://www.bcbe.org/board-of-education/bcbe-board-members", note:"Official BCBE board page."},

  {county:"Blount", role_key:"superintendent", full_name:"Rodney Green", title:"Superintendent", email:"rgreen@blountboe.net", phone:"205-775-1950", source_url:"https://www.blountboe.net/link-3", note:"Official Blount County Schools directory."},
  {county:"Blount", role_key:"assistant_superintendent", full_name:"Christopher Lakey", title:"Assistant Superintendent", email:"clakey@blountboe.net", phone:"205-775-1950", source_url:"https://www.blountboe.net/link-3", note:"Official Blount County Schools directory."},
  {county:"Blount", role_key:"it_director", full_name:"Brad Williams", title:"Technology Director", email:"bdwilliams@blountboe.net", phone:"205-775-1950", source_url:"https://www.blountboe.net/departments/technology", note:"Official Blount County Schools Technology page."},
  {county:"Blount", role_key:"security_director", full_name:"Meagan Holt", title:"Federal Programs Coordinator, EL/Migrant Coordinator, Safety Coordinator", email:"mholt@blountboe.net", phone:"205-775-1950", source_url:"https://www.blountboe.net/departments/federal-programs", note:"Official district page explicitly identifies Safety Coordinator; mapped as closest true school-safety executive."},
  {county:"Blount", role_key:"school_board", full_name:"Chris Latta", title:"Board Member, President, District V", email:null, phone:"205-775-1950", source_url:"https://www.blountboe.net/about-us/school-board", note:"Official Blount County Schools board page."},
  {county:"Blount", role_key:"school_board", full_name:"Jackie Sivley", title:"Board Member, Vice President, District II", email:null, phone:"205-775-1950", source_url:"https://www.blountboe.net/about-us/school-board", note:"Official Blount County Schools board page."},
  {county:"Blount", role_key:"school_board", full_name:"Ken Benton", title:"Board Member, District I", email:null, phone:"205-775-1950", source_url:"https://www.blountboe.net/about-us/school-board", note:"Official Blount County Schools board page."},
  {county:"Blount", role_key:"school_board", full_name:"Dr. Philip Cleveland", title:"Board Member, District III", email:null, phone:"205-775-1950", source_url:"https://www.blountboe.net/about-us/school-board", note:"Official Blount County Schools board page."},
  {county:"Blount", role_key:"school_board", full_name:"Daniel Smith", title:"Board Member, District IV", email:null, phone:"205-775-1950", source_url:"https://www.blountboe.net/about-us/school-board", note:"Official Blount County Schools board page."},

  {county:"Barbour", role_key:"superintendent", full_name:"Jimmie Fryer", title:"Superintendent", email:null, phone:"334-775-3453", source_url:"https://www.barbourcountyschools.org/article/2886265", note:"Official Barbour County Schools May 2026 publication identifies current superintendent."},
  {county:"Barbour", role_key:"it_director", full_name:"Geoff Jones", title:"Executive Director of Technology", email:null, phone:"334-775-3453", source_url:"https://www.barbourcountyschools.org/page/technology", note:"Official Barbour County Schools Technology page."}
] as const;

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  let upserted = 0;
  for (const r of rows) {
    const agencies = await sql.query(`select id from agencies where agency_type='k12' and state_code='AL' and (county ilike $1 or canonical_name ilike $2) order by case when county ilike $1 then 0 else 1 end, canonical_name limit 1`, [r.county, `%${r.county}%`]) as any[];
    const agencyId = agencies[0]?.id ?? null;
    await sql.query(`
      insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note,updated_at)
      values('AL',$1,$2,'district',$3,$4,$5,$6,$7,$8,'verified',now(),$9,now())
      on conflict do nothing
    `, [r.county, agencyId, r.role_key, r.full_name, r.title, r.email, r.phone, r.source_url, r.note]);
    upserted++;
  }

  await sql.query(`
    insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note,updated_at)
    values('AL',null,null,'state','state_security_director','Erica Butler, Ed.D.','Education Specialist - Crisis Management and School Safety','erica.butler@alsde.edu','334-694-4717','https://www.alabamaachieves.org/wp-content/uploads/2024/03/COMM_2024113_DAPS-2024_V1.0.pdf','candidate',null,'Official ALSDE directory identifies this school-safety role, but source is older than current review window; requires fresh 2026 confirmation before verified.',now())
    on conflict do nothing
  `);

  const summary = await sql.query(`select county, count(*) filter(where verification_status='verified')::int verified, count(*) filter(where verification_status='candidate')::int candidate, count(*) filter(where verification_status='missing')::int missing from raven_state_contacts where state_code='AL' group by county order by county nulls first`) as any[];
  console.log('RAVEN_ALABAMA_SEED', JSON.stringify(summary));
  return NextResponse.json({ok:true,upserted,summary});
}
