import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATE_CODES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
];

const INVALID_AGENCY = `(sheriff|juvenile (detention|justice)|department of corrections|correctional|school superintendent office|county school superintendent|education service agency|educational service agency|education service center|educational service center|special services)`;

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  const beforeRows = await sql.query(`
    select count(*)::int slots,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidate,
      count(*) filter(where verification_status='missing')::int missing,
      count(*) filter(where verification_status='rejected')::int rejected
    from raven_state_contacts
  `) as any[];

  const removedInvalid = await sql.query(`
    delete from raven_state_contacts c
    using agencies a
    where c.agency_id=a.id
      and c.scope='district'
      and a.canonical_name ~* $1
    returning c.id
  `,[INVALID_AGENCY]) as any[];

  const districtSlots = await sql.query(`
    insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status)
    select a.state_code,a.county,a.id,'district',r.role_key,'missing'
    from agencies a
    cross join (values
      ('security_director'),
      ('school_board'),
      ('superintendent'),
      ('assistant_superintendent'),
      ('it_director')
    ) r(role_key)
    where a.agency_type='k12'
      and a.state_code = any($1::text[])
      and a.canonical_name !~* $2
      and not exists (
        select 1 from raven_state_contacts x
        where x.state_code=a.state_code
          and x.agency_id=a.id
          and x.scope='district'
          and x.role_key=r.role_key
      )
    returning id
  `,[STATE_CODES,INVALID_AGENCY]) as any[];

  const stateSlots = await sql.query(`
    insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status)
    select s,null,null,'state','state_security_director','missing'
    from unnest($1::text[]) s
    where not exists (
      select 1 from raven_state_contacts x
      where x.state_code=s and x.scope='state' and x.role_key='state_security_director'
    )
    returning id
  `,[STATE_CODES]) as any[];

  const filled = await sql.query(`
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
          or (c.role_key='security_director' and p.title ~* '(director|chief|executive director|senior director|associate superintendent).{0,80}(security|school safety|public safety|safety and security|security and safety|emergency management|safe schools)|(security|school safety|public safety|safety and security|security and safety|emergency management|safe schools).{0,80}(director|chief|executive director|senior director|associate superintendent)')
          or (c.role_key='it_director' and p.title ~* '(director|executive director|chief information officer|chief technology officer|(^|[^a-z])cio([^a-z]|$)|(^|[^a-z])cto([^a-z]|$)).{0,60}(information technology|technology|information systems|it services|network services|tech infrastructure|cybersecurity)|(information technology|technology|information systems|it services|network services|tech infrastructure|cybersecurity).{0,60}(director|chief information officer|chief technology officer|(^|[^a-z])cio([^a-z]|$)|(^|[^a-z])cto([^a-z]|$))')
          or (c.role_key='school_board' and p.title ~* '(school|governing)?[[:space:]]*board[[:space:]]+(member|chair|chairman|chairwoman|president|vice president|trustee|clerk)|board trustee')
        )
    )
    update raven_state_contacts c
    set full_name=r.full_name,title=r.title,email=r.email,phone=r.phone,source_url=r.source_url,
        verification_status='candidate',
        evidence_note='Candidate from official K-12 source; awaiting strict live revalidation.',
        updated_at=now()
    from ranked r
    where c.id=r.contact_id and r.rn=1
    returning c.id
  `) as any[];

  const states = await sql.query(`
    select state_code,count(*)::int slots,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidate,
      count(*) filter(where verification_status='missing')::int missing,
      count(*) filter(where verification_status='rejected')::int rejected
    from raven_state_contacts group by state_code order by state_code
  `) as any[];

  const afterRows = await sql.query(`
    select count(*)::int slots,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidate,
      count(*) filter(where verification_status='missing')::int missing,
      count(*) filter(where verification_status='rejected')::int rejected
    from raven_state_contacts
  `) as any[];

  const before = beforeRows[0] || null;
  const after = afterRows[0] || null;
  const summary = { before, after, invalidSlotsRemoved: removedInvalid.length, districtSlotsAdded: districtSlots.length, stateSlotsAdded: stateSlots.length, candidatesFilled: filled.length };
  console.log('RAVEN_STATE_FILL', summary);

  return NextResponse.json({ok:true,...summary,states});
}
