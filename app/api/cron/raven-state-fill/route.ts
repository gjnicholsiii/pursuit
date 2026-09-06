import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Counts={total:number;verified:number;candidate:number;missing:number;rejected:number};

async function counts(sql:ReturnType<typeof getSql>):Promise<Counts>{
  const rows=await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[];
  return rows[0] as Counts;
}

const STATE_ROUTES=[
  "/api/cron/raven-alabama-authoritative",
  "/api/cron/raven-arkansas-authoritative",
  "/api/cron/raven-idaho-authoritative",
  "/api/cron/raven-indiana-authoritative",
  "/api/cron/raven-iowa-authoritative",
  "/api/cron/raven-mississippi-authoritative",
  "/api/cron/raven-montana-bulk",
  "/api/cron/raven-nebraska-authoritative",
  "/api/cron/raven-nevada-authoritative",
  "/api/cron/raven-oklahoma-authoritative",
  "/api/cron/raven-pennsylvania-authoritative",
  "/api/cron/raven-rhode-island-authoritative",
  "/api/cron/raven-utah-authoritative"
];

function deploymentOrigin(req:NextRequest){
  const exact=process.env.VERCEL_URL?.trim();
  if(exact)return exact.startsWith("http")?exact:`https://${exact}`;
  return req.nextUrl.origin;
}

async function runState(req:NextRequest,path:string){
  const headers:Record<string,string>={};
  const authorization=req.headers.get("authorization");
  if(authorization)headers.authorization=authorization;
  const started=Date.now();
  const origin=deploymentOrigin(req);
  try{
    const url=new URL(path,origin);
    const res=await fetch(url,{cache:"no-store",headers,redirect:"manual"});
    const text=await res.text();
    const contentType=res.headers.get("content-type")||"";
    let body:any=null;
    try{body=JSON.parse(text);}catch{}
    const json=body!==null&&typeof body==="object";
    const ok=res.ok&&json;
    return {
      path,
      url:url.toString(),
      status:res.status,
      ok,
      json,
      contentType,
      ms:Date.now()-started,
      body:json?body:text.slice(0,240)
    };
  }catch(err){
    return {path,status:0,ok:false,json:false,ms:Date.now()-started,error:err instanceof Error?err.message:String(err)};
  }
}

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const before=await counts(sql);

  const stateRuns=await Promise.all(STATE_ROUTES.map(path=>runState(req,path)));

  const filled=await sql.query(`
    with ranked as (
      select c.id contact_id,p.full_name,p.title,p.email,p.phone,p.source_url,p.confidence,p.role_family,
        row_number() over(
          partition by c.id
          order by (p.email is not null and btrim(p.email)<>'') desc,
                   (p.phone is not null and btrim(p.phone)<>'') desc,
                   p.confidence desc,p.full_name
        ) rn
      from raven_state_contacts c
      join raven_people p on p.agency_id=c.agency_id
      where c.verification_status='missing'
        and c.scope='district'
        and p.full_name is not null and btrim(p.full_name)<>''
        and p.title is not null and btrim(p.title)<>''
        and p.source_url is not null and btrim(p.source_url)<>''
        and (
          c.role_key='superintendent'
          or (p.email is not null and btrim(p.email)<>'')
          or (p.phone is not null and btrim(p.phone)<>'')
        )
        and p.title !~* '(facilit(y|ies)|plant|maintenance|buildings?[[:space:]]*(and|&)[[:space:]]*grounds|procurement|purchasing|finance|financial|principal|teacher|operations?|transportation|food service|human resources|(^|[^a-z])hr([^a-z]|$))'
        and (
          (c.role_key='superintendent' and p.title ~* 'superintendent' and p.title !~* '(assistant|deputy|associate)[[:space:]]+superintendent')
          or (c.role_key='assistant_superintendent' and p.title ~* '(assistant|asst\\.?|associate|deputy)[[:space:]]+superintendent')
          or (c.role_key='security_director' and p.title ~* '(director|chief|executive director|senior director|associate superintendent).{0,80}(security|school safety|public safety|safety and security|security and safety|emergency management|safe schools)|(security|school safety|public safety|safety and security|security and safety|emergency management|safe schools).{0,80}(director|chief|executive director|senior director|associate superintendent)')
          or (c.role_key='it_director' and p.title ~* '(director|executive director|chief information officer|chief technology officer|(^|[^a-z])cio([^a-z]|$)|(^|[^a-z])cto([^a-z]|$)).{0,60}(information technology|technology|information systems|it services|network services|tech infrastructure|cybersecurity)|(information technology|technology|information systems|it services|network services|tech infrastructure|cybersecurity).{0,60}(director|chief information officer|chief technology officer|(^|[^a-z])cio([^a-z]|$)|(^|[^a-z])cto([^a-z]|$))')
          or (c.role_key='school_board' and ((p.role_family='Board' and p.title ~* '(member|chair|chairman|chairwoman|president|vice president|trustee|clerk)') or p.title ~* '(school|governing)?[[:space:]]*board[[:space:]]+(member|chair|chairman|chairwoman|president|vice president|trustee|clerk)|board trustee'))
        )
    )
    update raven_state_contacts c
    set full_name=r.full_name,
        title=r.title,
        email=r.email,
        phone=r.phone,
        source_url=r.source_url,
        verification_status='candidate',
        evidence_note=case
          when c.role_key='superintendent' and (r.email is null or btrim(r.email)='') and (r.phone is null or btrim(r.phone)='')
            then 'Current superintendent identity from a sourced K-12 public record; no contact detail inferred; awaiting strict live revalidation.'
          else 'Reachable candidate from an official K-12 public source; published email or phone present; awaiting strict live revalidation.'
        end,
        updated_at=now()
    from ranked r
    where c.id=r.contact_id and r.rn=1
    returning c.id::text,c.agency_id::text
  `) as any[];

  const after=await counts(sql);
  const districtsNewlyFilled=new Set(filled.map(r=>r.agency_id).filter(Boolean)).size;
  const stateRunsOk=stateRuns.filter(r=>r.ok).length;
  const stateRunsFailed=stateRuns.length-stateRunsOk;
  const summary={
    ok:stateRunsFailed===0,
    mode:"parallel-statewide-authoritative-plus-promotion",
    deploymentOrigin:deploymentOrigin(req),
    before,after,
    net:{
      total:after.total-before.total,
      verified:after.verified-before.verified,
      candidate:after.candidate-before.candidate,
      missing:after.missing-before.missing,
      rejected:after.rejected-before.rejected
    },
    stateRunsOk,
    stateRunsFailed,
    stateRuns,
    candidatesFilled:filled.length,
    districtsNewlyFilled
  };
  console.log("RAVEN_STATE_FILL",JSON.stringify(summary));
  return NextResponse.json(summary,{status:stateRunsFailed===0?200:207});
}
