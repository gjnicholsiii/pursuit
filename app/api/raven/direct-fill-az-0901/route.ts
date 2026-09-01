import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Row = {
  orgLike?: string;
  role: string;
  fullName: string;
  title: string;
  email?: string | null;
  phone?: string | null;
  source: string;
  note: string;
};

const rows: Row[] = [
  {role:'state_security_director',fullName:'Mike Kurtenbach',title:'Associate Superintendent, School Safety Division',phone:'602-364-2281',source:'https://www.azed.gov/sites/default/files/2025/07/FY26%20SSP%20Manual%20for%20CSWs%20schools.pdf',note:'Arizona Department of Education FY26 School Safety Program manual identifies Mike Kurtenbach as Associate Superintendent, School Safety Division.'},
  {orgLike:'Scottsdale Unified',role:'superintendent',fullName:'Dr. Scott A. Menzel',title:'Superintendent',phone:'480-484-6100',source:'https://www.susd.org/our-district/leadership/superintendent',note:'Official Scottsdale Unified superintendent page identifies Dr. Scott A. Menzel as Superintendent.'},
  {orgLike:'Scottsdale Unified',role:'assistant_superintendent',fullName:'Dr. Milissa Sackos',title:'Assistant Superintendent, Secondary Education',email:'msackos@susd.org',phone:'480-484-6239',source:'https://www.susd.org/departments/legal/title-ix-non-discrimination-policy',note:'Official Scottsdale Unified Title IX page identifies Dr. Milissa Sackos as Assistant Superintendent, Secondary Education.'},
  {orgLike:'Scottsdale Unified',role:'security_director',fullName:'Josh Friedman',title:'Director Safety & Security',phone:'480-484-8640',source:'https://www.susd.org/our-district/leadership',note:'Official Scottsdale Unified leadership page identifies Josh Friedman as Director Safety & Security.'},
  {orgLike:'Scottsdale Unified',role:'it_director',fullName:'Kristine Harrington',title:'Chief Communications & Information Officer',phone:'480-404-2417',source:'https://www.susd.org/departments/information-technology',note:'Official Scottsdale Unified Information Technology page identifies Kristine Harrington as Chief Communications & Information Officer and IT department contact.'},
  {orgLike:'Scottsdale Unified',role:'school_board',fullName:'Dr. Donna W. Lewis',title:'Governing Board President',email:'govbrd@susd.org',phone:'480-484-6100',source:'https://www.susd.org/our-district/governing-board/governing-board-members',note:'Official Scottsdale Unified Governing Board page identifies Dr. Donna W. Lewis as Governing Board President.'},
  {orgLike:'Peoria Unified',role:'superintendent',fullName:'Tahlya Visintainer',title:'Interim Superintendent',source:'https://www.peoriaunified.org/article/2922946',note:'Official Peoria Unified announcement states Tahlya Visintainer is Interim Superintendent from May 26, 2026 through June 30, 2027.'},
  {orgLike:'Peoria Unified',role:'school_board',fullName:'Jeff Tobey',title:'Governing Board President',source:'https://www.peoriaunified.org/page/current-board-members',note:'Official Peoria Unified Governing Board page identifies Jeff Tobey as Governing Board President.'},
  {orgLike:'Deer Valley Unified',role:'superintendent',fullName:'Dr. Curtis Finch',title:'Superintendent',email:'superintendent@dvusd.org',phone:'623-445-5002',source:'https://www.dvusd.org/departments/superintendent',note:'Official Deer Valley Unified superintendent page identifies Dr. Curtis Finch as Superintendent.'}
];

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('key') !== 'az-direct-0901') return NextResponse.json({ok:false},{status:404});
  const sql = getSql();

  const removed = await sql.query(`
    delete from raven_state_contacts c using agencies a
    where c.agency_id=a.id and c.scope='district'
      and a.canonical_name ~* '(sheriff|juvenile (detention|justice)|department of corrections|correctional|school superintendent office|county school superintendent|education service agency|educational service agency|education service center|educational service center|special services)'
    returning c.id
  `) as any[];

  let verified = 0;
  const results:any[] = [];

  for (const row of rows) {
    if (!row.orgLike) {
      await sql.query(`
        insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status)
        select 'AZ',null,null,'state',$1,'missing'
        where not exists(select 1 from raven_state_contacts where state_code='AZ' and scope='state' and role_key=$1)
      `,[row.role]);
      const updated = await sql.query(`
        update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,
          verification_status='verified',verified_at=now(),evidence_note=$7,updated_at=now()
        where state_code='AZ' and scope='state' and role_key=$1
        returning id
      `,[row.role,row.fullName,row.title,row.email||null,row.phone||null,row.source,row.note]) as any[];
      verified += updated.length;
      results.push({role:row.role,organization:'Arizona Department of Education',updated:updated.length});
      continue;
    }

    const agencies = await sql.query(`
      select id::text,canonical_name,county from agencies
      where state_code='AZ' and agency_type='k12' and canonical_name ilike $1
      order by canonical_name limit 1
    `,[`%${row.orgLike}%`]) as any[];
    const agency = agencies[0];
    if (!agency) { results.push({role:row.role,organization:row.orgLike,updated:0,reason:'agency not found'}); continue; }

    await sql.query(`
      insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status)
      select 'AZ',$2,$1::uuid,'district',$3,'missing'
      where not exists(select 1 from raven_state_contacts where agency_id=$1::uuid and scope='district' and role_key=$3)
    `,[agency.id,agency.county,row.role]);

    const updated = await sql.query(`
      update raven_state_contacts set full_name=$2,title=$3,email=$4,phone=$5,source_url=$6,
        verification_status='verified',verified_at=now(),evidence_note=$7,updated_at=now()
      where agency_id=$1::uuid and scope='district' and role_key=$8
      returning id
    `,[agency.id,row.fullName,row.title,row.email||null,row.phone||null,row.source,row.note,row.role]) as any[];
    verified += updated.length;
    results.push({role:row.role,organization:agency.canonical_name,updated:updated.length});
  }

  const counts = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected,max(updated_at) latest_update from raven_state_contacts`);
  const az = await sql.query(`select count(*)::int slots,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected,max(updated_at) latest_update from raven_state_contacts where state_code='AZ'`);
  return NextResponse.json({ok:true,invalidSlotsRemoved:removed.length,verifiedWrites:verified,results,totals:counts[0],az:az[0]});
}
