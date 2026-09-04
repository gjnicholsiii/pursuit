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

export async function GET(req:NextRequest){
  const auth=requireInternalAuth(req); if(auth)return auth;
  const sql=getSql();
  const before=await counts(sql);

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
        and ((p.email is not null and btrim(p.email)<>'') or (p.phone is not null and btrim(p.phone)<>''))
        and p.title !~* '(facilit(y|ies)|plant|maintenance|buildings?[[:space:]]*(and|&)[[:space:]]*grounds|procurement|purchasing|finance|financial|principal|teacher|operations?|transportation|food service|human resources|(^|[^a-z])hr([^a-z]|$))'
        and (
          (c.role_key='superintendent' and p.title ~* 'superintendent' and p.title !~* '(assistant|deputy|associate)[[:space:]]+superintendent')
          or (c.role_key='assistant_superintendent' and p.title ~* '(assistant|asst\\.?|associate)[[:space:]]+superintendent')
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
        evidence_note='Reachable candidate from an official K-12 public source; published email or phone present; awaiting strict live revalidation.',
        updated_at=now()
    from ranked r
    where c.id=r.contact_id and r.rn=1
    returning c.id::text,c.agency_id::text
  `) as any[];

  const after=await counts(sql);
  const districtsNewlyFilled=new Set(filled.map(r=>r.agency_id).filter(Boolean)).size;
  const summary={
    ok:true,
    mode:"bulk-official-k12-promotion",
    before,after,
    net:{
      total:after.total-before.total,
      verified:after.verified-before.verified,
      candidate:after.candidate-before.candidate,
      missing:after.missing-before.missing,
      rejected:after.rejected-before.rejected
    },
    candidatesFilled:filled.length,
    districtsNewlyFilled,
    repeatedStateFetches:0
  };
  console.log("RAVEN_STATE_FILL",summary);
  return NextResponse.json(summary);
}
