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
 const counts=await sql.query(`select count(*)::int people,count(distinct agency_id)::int organizations,count(*) filter(where email is not null)::int with_email,count(*) filter(where phone is not null)::int with_phone from raven_people`);
 return NextResponse.json({ok:true,counts:counts[0]});
}