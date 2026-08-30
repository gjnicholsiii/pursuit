import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

const SOURCE_STATE = "https://www.alabamaachieves.org/wp-content/uploads/2026/04/StateSuperIn_Memos_20260409_FY261008StudentIncidentCertifcation_v1.pdf";
const SOURCE_BALDWIN_SUPT = "https://www.bcbe.org/superintendent-senior-staff/superintendent";
const SOURCE_BALDWIN_SECURITY = "https://www.bcbe.org/departments/athletics-prevention-safety/safety";
const SOURCE_BALDWIN_IT = "https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-educational-technology";
const SOURCE_BALDWIN_ASST = "https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-secondary-education";
const SOURCE_BALDWIN_BOARD = "https://www.bcbe.org/board-of-education/bcbe-board-members";

async function ensure(sql: ReturnType<typeof getSql>) {
  await sql.query(`create table if not exists raven_state_contacts (
    id bigserial primary key,
    state_code text not null,
    county text,
    agency_id bigint references agencies(id) on delete set null,
    scope text not null check (scope in ('state','county','district')),
    role_key text not null check (role_key in ('state_security_director','security_director','school_board','superintendent','assistant_superintendent','it_director')),
    full_name text,
    title text,
    email text,
    phone text,
    source_url text,
    verification_status text not null default 'missing' check (verification_status in ('missing','candidate','verified','rejected')),
    verified_at timestamptz,
    evidence_note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`);
}

async function upsertSlot(sql: ReturnType<typeof getSql>, args: {
  state:string; county:string|null; agencyId:string|null; scope:'state'|'district'; role:string;
  name:string; title:string; email:string|null; phone:string|null; source:string; note:string;
  status?: 'verified'|'candidate';
}) {
  const status = args.status || 'verified';
  const existing = await sql.query(`select id from raven_state_contacts where state_code=$1 and coalesce(county,'')=coalesce($2,'') and coalesce(agency_id,0)=coalesce($3::bigint,0) and scope=$4 and role_key=$5 order by case verification_status when 'verified' then 0 when 'candidate' then 1 else 2 end,id limit 1`, [args.state,args.county,args.agencyId,args.scope,args.role]) as any[];
  if (existing[0]?.id) {
    await sql.query(`update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,verification_status=$7,verified_at=case when $7='verified' then now() else null end,evidence_note=$8,updated_at=now() where id=$1`, [existing[0].id,args.name,args.title,args.email,args.phone,args.source,status,args.note]);
  } else {
    await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,case when $11='verified' then now() else null end,$12)`, [args.state,args.county,args.agencyId,args.scope,args.role,args.name,args.title,args.email,args.phone,args.source,status,args.note]);
  }
}

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req); if (auth) return auth;
  const sql = getSql(); await ensure(sql);
  const agencies = await sql.query(`select id::text,canonical_name from agencies where state_code='AL' and agency_type='k12' and (canonical_name ilike '%Baldwin County%' or canonical_name ilike '%Baldwin%Public%School%') order by canonical_name limit 1`) as any[];
  const baldwinId = agencies[0]?.id || null;

  await upsertSlot(sql,{state:'AL',county:null,agencyId:null,scope:'state',role:'state_security_director',name:'Dr. Johnny Whaley',title:'Alabama State Department of Education school-safety contact',email:'johnny.whaley@alsde.edu',phone:null,source:SOURCE_STATE,note:'Current 2026 ALSDE Student Incident Report memorandum lists Dr. Johnny Whaley among the official contacts and copies him with LEA Safety Coordinators. The source supports him as a current state-level school-safety contact; no direct phone is published in this 2026 memo.'});

  if (baldwinId) {
    await upsertSlot(sql,{state:'AL',county:'Baldwin',agencyId:baldwinId,scope:'district',role:'superintendent',name:'Marty McRae',title:'Superintendent',email:null,phone:'251-937-0308',source:SOURCE_BALDWIN_SUPT,note:'Current BCBE superintendent page identifies Marty McRae as Superintendent and publishes the superintendent office phone. The page exposes an email link but not the address in accessible text, so email remains blank.'});
    await upsertSlot(sql,{state:'AL',county:'Baldwin',agencyId:baldwinId,scope:'district',role:'security_director',name:'Jeff Spaller',title:'Safety Supervisor',email:null,phone:'251-972-6854',source:SOURCE_BALDWIN_SECURITY,note:'Current BCBE Safety Department page identifies Jeff Spaller as Safety Supervisor and publishes office and cell numbers. This is a true district safety/security leadership role. Email link is present but the address is not exposed in accessible official text.'});
    await upsertSlot(sql,{state:'AL',county:'Baldwin',agencyId:baldwinId,scope:'district',role:'assistant_superintendent',name:'Joe Sharp',title:'Assistant Superintendent, Secondary Education',email:null,phone:null,source:SOURCE_BALDWIN_ASST,note:'Current BCBE Secondary Education page identifies Joe Sharp as Assistant Superintendent, Secondary. Email link is present but address and direct phone are not exposed in accessible official text.'});
    await upsertSlot(sql,{state:'AL',county:'Baldwin',agencyId:baldwinId,scope:'district',role:'school_board',name:'Tony Myrick',title:'BCBE Board President, District 3',email:null,phone:null,source:SOURCE_BALDWIN_BOARD,note:'Current official BCBE Board Members page identifies Tony Myrick as BCBE Board President, District 3. Email link is present but address and personal phone are not exposed in accessible official text.'});
    await upsertSlot(sql,{state:'AL',county:'Baldwin',agencyId:baldwinId,scope:'district',role:'it_director',name:'David A. Besancon, Ph.D., M.B.A.',title:'Assistant Superintendent, Educational Technology',email:'dbesancon@bcbe.org',phone:null,source:SOURCE_BALDWIN_IT,note:'Current BCBE page and staff directory identify Besancon as Assistant Superintendent, Educational Technology and publish dbesancon@bcbe.org. Because the requested slot is specifically IT Director and the current official title is not IT Director, this remains CANDIDATE rather than VERIFIED.',status:'candidate'});
  }

  const counts = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing from raven_state_contacts where state_code='AL'`) as any[];
  console.log('RAVEN_ALABAMA_PROGRESS', JSON.stringify({baldwinAgency:agencies[0]||null,counts:counts[0]||{}}));
  return NextResponse.json({ok:true,baldwinAgency:agencies[0]||null,counts:counts[0]||{}});
}
