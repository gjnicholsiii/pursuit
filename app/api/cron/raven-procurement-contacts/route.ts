import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic="force-dynamic";
export const maxDuration=300;

export async function GET(request:NextRequest){
 const secret=process.env.CRON_SECRET;if(!secret)return NextResponse.json({ok:false,error:'CRON_SECRET is not configured'},{status:503});if(request.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({ok:false,error:'Unauthorized'},{status:401});
 const sql=getSql();
 await sql.query(`with raw as (
   select o.agency_id,
     nullif(trim(coalesce(o.raw_payload->>'buyerName',o.raw_payload->>'contactName',case when jsonb_typeof(o.raw_payload->'buyer')='string' then o.raw_payload->>'buyer' end,case when jsonb_typeof(o.raw_payload->'contact')='string' then o.raw_payload->>'contact' end)), '') full_name,
     nullif(trim(coalesce(o.raw_payload->>'buyerEmail',o.raw_payload->>'agencyContactEmail',case when jsonb_typeof(o.raw_payload->'buyer')='object' then o.raw_payload->'buyer'->>'email' end,case when jsonb_typeof(o.raw_payload->'contact')='object' then o.raw_payload->'contact'->>'email' end)), '') email,
     nullif(trim(coalesce(o.raw_payload->>'buyerPhone',case when jsonb_typeof(o.raw_payload->'buyer')='object' then o.raw_payload->'buyer'->>'phone' end,case when jsonb_typeof(o.raw_payload->'contact')='object' then o.raw_payload->'contact'->>'phone' end)), '') phone,
     o.source_url,o.last_seen_at
   from opportunities o
 ), usable as (
   select * from raw where full_name is not null and length(full_name) between 3 and 100 and full_name !~* '^(n/?a|none|unknown|buyer|contact|procurement)$'
 ), agg as (
   select agency_id,full_name,
     (array_agg(email order by last_seen_at desc) filter(where email is not null))[1] email,
     (array_agg(phone order by last_seen_at desc) filter(where phone is not null))[1] phone,
     (array_agg(source_url order by last_seen_at desc))[1] source_url
   from usable group by agency_id,full_name
 )
 insert into raven_people(agency_id,full_name,title,role_family,email,phone,source_url,source_type,confidence,last_verified_at,updated_at)
 select agency_id,full_name,'Procurement Contact','Procurement',email,phone,source_url,'procurement_source',case when email is not null then 95 when phone is not null then 90 else 82 end,now(),now() from agg
 on conflict(agency_id,full_name,title) do update set email=coalesce(excluded.email,raven_people.email),phone=coalesce(excluded.phone,raven_people.phone),source_url=excluded.source_url,confidence=greatest(raven_people.confidence,excluded.confidence),last_verified_at=now(),updated_at=now()`);

 await sql.query(`with source_contacts as (
   select o.id opportunity_id,o.agency_id,o.title,o.source_url,o.last_seen_at,
     nullif(trim(coalesce(o.raw_payload->>'buyerName',o.raw_payload->>'contactName',case when jsonb_typeof(o.raw_payload->'buyer')='string' then o.raw_payload->>'buyer' end,case when jsonb_typeof(o.raw_payload->'contact')='string' then o.raw_payload->>'contact' end)), '') full_name
   from opportunities o
   where o.status='open' and (o.due_at is null or o.due_at>=now())
 ), matched as (
   select sc.*,rp.id person_id from source_contacts sc join raven_people rp on rp.agency_id=sc.agency_id and lower(rp.full_name)=lower(sc.full_name) and rp.title='Procurement Contact'
   where sc.full_name is not null
 )
 insert into raven_relationships(agency_id,person_id,relationship_type,related_name,related_url,evidence,confidence,first_seen_at,last_seen_at)
 select agency_id,person_id,'procurement_contact',title,source_url,jsonb_build_object('opportunity_id',opportunity_id::text,'source','opportunity_payload'),95,last_seen_at,last_seen_at from matched m
 where not exists(select 1 from raven_relationships r where r.person_id=m.person_id and r.relationship_type='procurement_contact' and r.related_url=m.source_url)`);
 const counts=await sql.query(`select (select count(*)::int from raven_people) people,(select count(distinct agency_id)::int from raven_people) organizations,(select count(*)::int from raven_people where email is not null) with_email,(select count(*)::int from raven_people where phone is not null) with_phone,(select count(*)::int from raven_relationships where relationship_type='procurement_contact') procurement_relationships`);
 return NextResponse.json({ok:true,counts:counts[0]});
}