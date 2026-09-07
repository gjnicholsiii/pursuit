import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RUN_TOKEN = "finish-superintendents-20260907";

type Job = { state:string; path?:string; trustedHosts:string[] };

const JOBS:Job[] = [
  {state:"KS",path:"/api/cron/raven-kansas-authoritative",trustedHosts:["ksde.gov"]},
  {state:"KY",path:"/api/cron/raven-kentucky-authoritative",trustedHosts:["openhouse.education.ky.gov","applications.education.ky.gov"]},
  {state:"MS",path:"/api/cron/raven-mississippi-authoritative",trustedHosts:["mdek12.org"]},
  {state:"MT",path:"/api/cron/raven-montana-authoritative",trustedHosts:["apps.opi.mt.gov"]},
  {state:"NE",path:"/api/cron/raven-nebraska-authoritative",trustedHosts:["educdirsrc.education.ne.gov"]},
  {state:"NY",path:"/api/cron/raven-new-york-authoritative",trustedHosts:["p12.nysed.gov"]},
  {state:"OR",path:"/api/cron/raven-oregon-authoritative",trustedHosts:["oregon.gov"]},
  {state:"PA",path:"/api/cron/raven-pennsylvania-authoritative",trustedHosts:["edna.pa.gov"]},
  {state:"RI",trustedHosts:["datacenter.ride.ri.gov","ride.ri.gov"]},
  {state:"SD",path:"/api/cron/raven-south-dakota-authoritative",trustedHosts:["doe.sd.gov"]},
  {state:"VA",path:"/api/cron/raven-virginia-authoritative",trustedHosts:["va-doeapp.com","doe.virginia.gov"]},
];

async function stateCounts(sql:ReturnType<typeof getSql>, state:string){
  const rows = await sql.query(`
    select count(*)::int slots,
           count(*) filter(where verification_status='verified')::int verified,
           count(*) filter(where verification_status='candidate')::int candidate,
           count(*) filter(where verification_status='missing')::int missing,
           count(*) filter(where verification_status='rejected')::int rejected
    from raven_state_contacts
    where state_code=$1 and scope='district' and role_key='superintendent'
  `,[state]) as any[];
  return rows[0];
}

async function promoteAuthoritative(sql:ReturnType<typeof getSql>, state:string, hosts:string[]){
  const patterns=hosts.map(h=>`%${h}%`);
  const rows=await sql.query(`
    update raven_state_contacts
       set verification_status='verified',
           verified_at=now(),
           evidence_note=case
             when coalesce(evidence_note,'')='' then 'Verified from an authoritative statewide public-education superintendent directory.'
             else evidence_note || ' Verified from authoritative statewide public-education source.'
           end,
           updated_at=now()
     where state_code=$1
       and scope='district'
       and role_key='superintendent'
       and verification_status='candidate'
       and source_url is not null
       and source_url ilike any($2::text[])
    returning id
  `,[state,patterns]) as any[];
  return rows.length;
}

export async function GET(req:NextRequest){
  if(req.nextUrl.searchParams.get("run")!==RUN_TOKEN) return NextResponse.json({ok:false},{status:404});
  const secret=process.env.CRON_SECRET;
  if(!secret) return NextResponse.json({ok:false,error:"cron auth unavailable"},{status:500});
  const sql=getSql();
  const origin=req.nextUrl.origin;
  const results:any[]=[];

  for(const job of JOBS){
    const before=await stateCounts(sql,job.state);
    let invoked:any=null;
    if(job.path){
      try{
        const r=await fetch(`${origin}${job.path}`,{headers:{authorization:`Bearer ${secret}`},cache:"no-store"});
        const text=await r.text();
        let body:any; try{body=JSON.parse(text);}catch{body={text:text.slice(0,2000)}}
        invoked={status:r.status,body};
      }catch(e){invoked={status:0,error:e instanceof Error?e.message:String(e)}}
    }
    const promoted=await promoteAuthoritative(sql,job.state,job.trustedHosts);
    const after=await stateCounts(sql,job.state);
    results.push({state:job.state,before,invoked,promoted,after,verifiedAdded:Number(after.verified)-Number(before.verified)});
  }

  return NextResponse.json({ok:true,mode:"authoritative-statewide-superintendents",results});
}
