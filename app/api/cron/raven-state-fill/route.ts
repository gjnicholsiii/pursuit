import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATE_CODES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
];

const INVALID_AGENCY = `(sheriff|juvenile (detention|justice)|department of corrections|correctional|school superintendent office|county school superintendent|education service agency|educational service agency|education service center|educational service center|special services)`;
const FLDOE_SUPERINTENDENTS = "https://www.fldoe.org/accountability/data-sys/school-dis-data/superintendents.stml";

type FlSuperintendent = { district: string; fullName: string; title: string; email: string; phone: string };

function clean(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function stripHonorific(value: string) {
  return clean(value).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i, "");
}

async function fetchFloridaSuperintendents(): Promise<FlSuperintendent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(FLDOE_SUPERINTENDENTS, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; Pursuit-Raven/3.0; authoritative-public-directory)",
        accept: "text/html,application/xhtml+xml"
      }
    });
    if (!res.ok) throw new Error(`Florida DOE roster HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const lines = $("body").text().split(/\r?\n/).map(clean).filter(Boolean);
    const rows: FlSuperintendent[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!/\b(?:Interim\s+)?Superintendent\b/i.test(line)) continue;
      if (/superintendents? of florida|school superintendents|superintendent and school district/i.test(line)) continue;
      const comma = line.indexOf(",");
      if (comma < 2) continue;
      const fullName = stripHonorific(line.slice(0, comma));
      const title = clean(line.slice(comma + 1));
      const district = clean(lines[i - 1]).replace(/^\*+|\*+$/g, "");
      if (!district || district.length > 60 || /home|district data|florida public school/i.test(district)) continue;

      let email = "";
      let phone = "";
      for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
        const next = lines[j];
        const emailMatch = next.match(/(?:E-?mail|Email)\s*:\s*([^\s]+@[^\s]+)/i);
        if (emailMatch) email = emailMatch[1].replace(/[;,]+$/, "").trim();
        const phoneMatch = next.match(/Supt\.\s*Phone\s*:\s*(.+)$/i);
        if (phoneMatch) phone = clean(phoneMatch[1]);
        if (email && phone) break;
      }
      if (!fullName || (!email && !phone)) continue;
      if (email && !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) email = "";
      if (!email && !phone) continue;
      rows.push({ district, fullName, title, email, phone });
    }

    const deduped = new Map<string, FlSuperintendent>();
    for (const row of rows) deduped.set(row.district.toLowerCase(), row);
    return [...deduped.values()];
  } finally {
    clearTimeout(timer);
  }
}

async function ingestFloridaSuperintendents(sql: ReturnType<typeof getSql>) {
  let roster: FlSuperintendent[] = [];
  try {
    roster = await fetchFloridaSuperintendents();
  } catch (error) {
    console.error("RAVEN_FLDOE_FETCH", error);
    return { fetched: 0, matched: 0, filled: 0, error: error instanceof Error ? error.message : String(error) };
  }

  let matched = 0;
  let filled = 0;
  for (const row of roster) {
    const districtKey = row.district.replace(/\s+County$/i, "").trim();
    const updated = await sql.query(`
      with target as (
        select c.id
        from raven_state_contacts c
        left join agencies a on a.id=c.agency_id
        where c.state_code='FL'
          and c.scope='district'
          and c.role_key='superintendent'
          and c.verification_status='missing'
          and (
            lower(regexp_replace(coalesce(c.county,''),'[[:space:]]+county$','','i'))=lower($1)
            or lower(coalesce(a.canonical_name,'')) like '%' || lower($1) || '%'
          )
        order by case when lower(regexp_replace(coalesce(c.county,''),'[[:space:]]+county$','','i'))=lower($1) then 0 else 1 end
        limit 1
      )
      update raven_state_contacts c
      set full_name=$2,
          title=$3,
          email=nullif($4,''),
          phone=nullif($5,''),
          source_url=$6,
          verification_status='candidate',
          evidence_note='Reachable superintendent from authoritative Florida Department of Education district superintendent directory; awaiting strict live revalidation.',
          updated_at=now()
      from target t
      where c.id=t.id
      returning c.id
    `,[districtKey,row.fullName,row.title,row.email,row.phone,FLDOE_SUPERINTENDENTS]) as any[];
    if (updated.length) {
      matched++;
      filled += updated.length;
    }
  }
  return { fetched: roster.length, matched, filled, error: null };
}

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

  const districtSlotsAdded = 0;

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

  const floridaDoe = await ingestFloridaSuperintendents(sql);

  const filled = await sql.query(`
    with ranked as (
      select c.id contact_id,p.full_name,p.title,p.email,p.phone,p.source_url,p.confidence,
        row_number() over(
          partition by c.id
          order by (p.email is not null and btrim(p.email)<>'') desc,
                   (p.phone is not null and btrim(p.phone)<>'') desc,
                   p.confidence desc,
                   p.full_name
        ) rn
      from raven_state_contacts c
      join raven_people p on p.agency_id=c.agency_id
      where c.verification_status='missing'
        and c.scope='district'
        and p.full_name is not null and btrim(p.full_name)<>''
        and p.title is not null and btrim(p.title)<>''
        and p.source_url is not null and btrim(p.source_url)<>''
        and (
          (p.email is not null and btrim(p.email)<>'')
          or (p.phone is not null and btrim(p.phone)<>'')
        )
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
        evidence_note='Reachable candidate from official K-12 source; email or phone present; awaiting strict live revalidation.',
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
  const summary = { before, after, invalidSlotsRemoved: removedInvalid.length, districtSlotsAdded, stateSlotsAdded: stateSlots.length, floridaDoe, candidatesFilled: filled.length };
  console.log('RAVEN_STATE_FILL', summary);

  return NextResponse.json({ok:true,...summary,states});
}
