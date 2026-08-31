import { NextRequest, NextResponse } from "next/server";
import { enrichK12Batch } from "@/lib/raven/k12-enrichment";
import { requireInternalAuth } from "@/lib/internal-auth";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = requireInternalAuth(request);
  if (auth) return auth;

  try {
    const sql=getSql();
    const active=await sql.query(`select count(*)::int n from raven_enrichment_runs where status='running' and started_at>now()-interval '6 minutes'`) as Array<{n:number}>;
    if(Number(active[0]?.n||0)>0)return NextResponse.json({ok:true,skipped:true,reason:'Raven K-12 bulk batch already running',running:Number(active[0]?.n||0)});
    await sql.query(`update raven_enrichment_runs set status='failed',completed_at=now(),diagnostics=coalesce(diagnostics,'{}'::jsonb)||jsonb_build_object('error','stale enrichment lease expired') where status='running' and started_at<=now()-interval '6 minutes'`);

    // One expensive invocation should do real work. The old cap of 8 districts
    // forced hundreds of tiny Vercel invocations and made nationwide completion
    // unnecessarily slow. Run a much larger district batch inside the same 300s
    // function budget; the enrichment layer stops naturally when the invocation ends.
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 24);
    const limit = Math.max(1, Math.min(requestedLimit, 24));
    const result = await enrichK12Batch(limit);

    const removed=await sql.query(`delete from raven_people where source_type='public_web' and full_name ~* '(quick links|in this section|testing|environmental|air quality|water.*testing|road$|street$|avenue$|boulevard$|highway$|^event details$|^scroll down$|^please register|^new student enrollment$|^view spending$|^committee members$|^term expires$|^current bids$|^watch the latest meeting$)' returning id`);

    // Immediately move newly discovered strict-role matches into the review queue.
    const promoted=await sql.query(`
      with ranked as (
        select c.id contact_id,p.full_name,p.title,p.email,p.phone,p.source_url,p.confidence,
          row_number() over(partition by c.id order by p.confidence desc,(p.email is not null) desc,p.full_name) rn
        from raven_state_contacts c
        join raven_people p on p.agency_id=c.agency_id
        where c.verification_status='missing'
          and c.scope='district'
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
      update raven_state_contacts c
      set full_name=r.full_name,title=r.title,email=r.email,phone=r.phone,source_url=r.source_url,
          verification_status='candidate',evidence_note='Bulk candidate from official K-12 discovery; awaiting live revalidation.',updated_at=now()
      from ranked r where c.id=r.contact_id and r.rn=1
      returning c.id
    `);

    return NextResponse.json({ ok: true, ...result, falsePeopleRemoved: removed.length, candidatesPromoted: promoted.length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
