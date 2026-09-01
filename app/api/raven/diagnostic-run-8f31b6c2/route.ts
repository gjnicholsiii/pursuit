import { NextRequest, NextResponse } from "next/server";
import { enrichK12Batch } from "@/lib/raven/k12-enrichment";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== "rvn-9a71c44e0b63") return NextResponse.json({ok:false},{status:404});
  const started = Date.now();
  const result = await enrichK12Batch(48);
  const sql = getSql();
  const promoted = await sql.query(`
    with ranked as (
      select c.id contact_id,p.full_name,p.title,p.email,p.phone,p.source_url,p.confidence,
        row_number() over(partition by c.id order by p.confidence desc,(p.email is not null) desc,p.full_name) rn
      from raven_state_contacts c
      join raven_people p on p.agency_id=c.agency_id
      where c.verification_status='missing' and c.scope='district'
        and p.full_name is not null and btrim(p.full_name)<>''
        and p.title is not null and btrim(p.title)<>''
        and p.source_url is not null and btrim(p.source_url)<>''
        and p.title !~* '(facilit(y|ies)|plant|maintenance|buildings?[[:space:]]*(and|&)[[:space:]]*grounds|procurement|purchasing|finance|financial|principal|teacher|operations?|transportation|food service|human resources|(^|[^a-z])hr([^a-z]|$))'
        and (
          (c.role_key='superintendent' and p.title ~* 'superintendent' and p.title !~* '(assistant|deputy|associate)[[:space:]]+superintendent')
          or (c.role_key='assistant_superintendent' and p.title ~* '(assistant|asst\\.?)[[:space:]]+superintendent')
          or (c.role_key='security_director' and p.title ~* '(director|chief|executive director|senior director|associate superintendent|program coordinator).{0,80}(security|school safety|public safety|safety and security|security and safety|emergency management|safe schools)|(security|school safety|public safety|safety and security|security and safety|emergency management|safe schools).{0,80}(director|chief|executive director|senior director|associate superintendent|program coordinator)')
          or (c.role_key='it_director' and p.title ~* '(director|executive director|chief information officer|chief technology officer|(^|[^a-z])cio([^a-z]|$)|(^|[^a-z])cto([^a-z]|$)).{0,60}(information technology|technology|information systems|it services|network services|tech infrastructure|cybersecurity)|(information technology|technology|information systems|it services|network services|tech infrastructure|cybersecurity).{0,60}(director|chief information officer|chief technology officer|(^|[^a-z])cio([^a-z]|$)|(^|[^a-z])cto([^a-z]|$))')
          or (c.role_key='school_board' and p.title ~* '(school|governing)?[[:space:]]*board[[:space:]]+(member|chair|chairman|chairwoman|president|vice president|trustee|clerk)|board trustee')
        )
    )
    update raven_state_contacts c set full_name=r.full_name,title=r.title,email=r.email,phone=r.phone,source_url=r.source_url,
      verification_status='candidate',evidence_note='Diagnostic bulk candidate from official K-12 discovery; awaiting strict revalidation.',updated_at=now()
    from ranked r where c.id=r.contact_id and r.rn=1 returning c.id
  `) as any[];
  const counts = await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected,max(updated_at) latest_update from raven_state_contacts`);
  return NextResponse.json({ok:true,elapsedMs:Date.now()-started,result,promoted:promoted.length,counts:counts[0]||null});
}
