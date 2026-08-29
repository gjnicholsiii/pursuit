import Link from "next/link";
import { Sidebar } from "@/components/sidebar";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

type ContactRow = { id:string; state_code:string; county:string|null; agency_name:string|null; scope:string; role_key:string; full_name:string|null; title:string|null; email:string|null; phone:string|null; source_url:string|null; verification_status:string; };

const ROLE_LABELS: Record<string,string> = {
  state_security_director: "State Security Director",
  security_director: "Security Director",
  school_board: "School Board",
  superintendent: "Superintendent",
  assistant_superintendent: "Assistant Superintendent",
  it_director: "IT Director",
};

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

async function ensureReviewTable(sql: ReturnType<typeof getSql>) {
  await sql.query(`create table if not exists raven_state_contacts (
    id bigserial primary key,
    state_code text not null,
    county text,
    agency_id uuid references agencies(id) on delete set null,
    scope text not null check (scope in ('state','county','district')),
    role_key text not null check (role_key in ('state_security_director','security_director','school_board','superintendent','assistant_superintendent','it_director')),
    full_name text,title text,email text,phone text,source_url text,
    verification_status text not null default 'missing' check (verification_status in ('missing','candidate','verified','rejected')),
    verified_at timestamptz,evidence_note text,
    created_at timestamptz not null default now(),updated_at timestamptz not null default now()
  )`);
  await sql.query(`create unique index if not exists raven_state_contacts_unique_slot on raven_state_contacts(state_code,coalesce(county,''),coalesce(agency_id,'00000000-0000-0000-0000-000000000000'::uuid),scope,role_key,coalesce(lower(full_name),''))`);
  await sql.query(`create index if not exists raven_state_contacts_state_idx on raven_state_contacts(state_code,county,role_key,verification_status)`);
  await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status)
    select a.state_code,a.county,a.id,'district',r.role_key,'missing'
    from agencies a cross join (values ('security_director'),('school_board'),('superintendent'),('assistant_superintendent'),('it_director')) r(role_key)
    where a.agency_type='k12' and a.state_code is not null and a.county is not null and btrim(a.county)<>''
      and (a.jurisdiction_level='county' or a.canonical_name ilike '%county%')
    on conflict do nothing`);
  await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,verification_status)
    select distinct a.state_code,null,null,'state','state_security_director','missing'
    from agencies a where a.agency_type='k12' and a.state_code is not null
    on conflict do nothing`);
  await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,evidence_note)
    select a.state_code,a.county,a.id,'district',
      case
        when lower(rp.title) ~ '(assistant|asst\\.?)[[:space:]-]+superintendent' then 'assistant_superintendent'
        when lower(rp.title) ~ '(^|[[:space:]])superintendent([[:space:]]|$)' and lower(rp.title) !~ '(assistant|asst\\.?|deputy|associate)' then 'superintendent'
        when lower(rp.title) ~ '(director|chief).*(security|school safety|public safety)|(security|school safety|public safety).*(director|chief)' then 'security_director'
        when lower(rp.title) ~ 'director.*(information technology|technology|information systems|it services)|(information technology|technology|information systems).*(director)' then 'it_director'
        when lower(rp.title) ~ '(school )?board (member|chair|chairman|chairwoman|president|vice president|trustee)|board trustee' then 'school_board'
      end,
      rp.full_name,rp.title,rp.email,rp.phone,rp.source_url,'candidate','Imported from existing Raven record; requires official-source verification before sending.'
    from raven_people rp join agencies a on a.id=rp.agency_id
    where a.agency_type='k12' and a.state_code is not null and a.county is not null and btrim(a.county)<>''
      and (a.jurisdiction_level='county' or a.canonical_name ilike '%county%')
      and rp.full_name is not null and btrim(rp.full_name)<>'' and rp.title is not null and btrim(rp.title)<>''
      and rp.source_url is not null and btrim(rp.source_url)<>''
      and (
        lower(rp.title) ~ '(assistant|asst\\.?)[[:space:]-]+superintendent'
        or (lower(rp.title) ~ '(^|[[:space:]])superintendent([[:space:]]|$)' and lower(rp.title) !~ '(assistant|asst\\.?|deputy|associate)')
        or lower(rp.title) ~ '(director|chief).*(security|school safety|public safety)|(security|school safety|public safety).*(director|chief)'
        or lower(rp.title) ~ 'director.*(information technology|technology|information systems|it services)|(information technology|technology|information systems).*(director)'
        or lower(rp.title) ~ '(school )?board (member|chair|chairman|chairwoman|president|vice president|trustee)|board trustee'
      )
      and lower(rp.title) !~ '(facilit|plant|maintenance|operations|buildings|grounds|procurement|purchasing|finance|financial)'
    on conflict do nothing`);
}

async function loadRows(sql: ReturnType<typeof getSql>, state:string) {
  return await sql.query(`select c.id::text,c.state_code,c.county,a.canonical_name agency_name,c.scope,c.role_key,c.full_name,c.title,c.email,c.phone,c.source_url,c.verification_status
    from raven_state_contacts c left join agencies a on a.id=c.agency_id where c.state_code=$1
    order by case when c.scope='state' then 0 else 1 end,coalesce(c.county,''),coalesce(a.canonical_name,''),
      case c.role_key when 'state_security_director' then 0 when 'security_director' then 1 when 'superintendent' then 2 when 'assistant_superintendent' then 3 when 'it_director' then 4 else 5 end,
      case c.verification_status when 'verified' then 0 when 'candidate' then 1 when 'missing' then 2 else 3 end,coalesce(c.full_name,'')`,[state]) as ContactRow[];
}

export default async function RavenContactsPage({ searchParams }: { searchParams?: Promise<Record<string,string|string[]|undefined>> }) {
  const params = (await searchParams) || {};
  const state = typeof params.state === "string" ? params.state.toUpperCase().slice(0,2) : "AL";
  const sql = getSql();
  let rows: ContactRow[] = [];
  let counts = {verified:0,candidate:0,missing:0,total:0};
  let error: string | null = null;
  try {
    await ensureReviewTable(sql);
    rows = await loadRows(sql,state);
    counts = rows.reduce((acc,row)=>{acc.total++; if(row.verification_status==='verified')acc.verified++; else if(row.verification_status==='candidate')acc.candidate++; else if(row.verification_status==='missing')acc.missing++; return acc;},counts);
  } catch (e) { error = e instanceof Error ? e.message : "Unable to load contact review data"; }

  return <main className="shell"><Sidebar active="Raven"/><section className="workspace"><header className="topbar"><div style={{display:'flex',gap:12,alignItems:'center'}}><Link href="/raven">← Raven</Link><strong>STATE CONTACT REVIEW</strong></div></header><div className="content">
    <div className="hero-row"><div><span className="eyebrow">RAVEN / PRE-SEND REVIEW</span><h1>{state} SECURITY CONTACT DATABASE</h1><p>Only verified contacts become eligible for outreach. Facilities, plant, maintenance and generic operations roles are excluded.</p></div></div>
    <section className="readiness-panel"><div className="readiness-copy"><span className="eyebrow">STATE</span><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{STATES.map(s=><Link key={s} href={`/raven/contacts?state=${s}`} style={{fontWeight:s===state?800:500}}>{s}</Link>)}</div></div></section>
    <section className="section-block"><div className="section-heading"><div><span>REVIEW STATUS</span><h2>{counts.total.toLocaleString()} records / slots</h2></div><div><strong>{counts.verified} VERIFIED · {counts.candidate} CANDIDATES · {counts.missing} MISSING</strong><small style={{display:'block'}}>Nothing sends from this page.</small></div></div>
    {error?<div className="readiness-panel"><div className="readiness-copy"><h2>Database needs attention</h2><p>{error}</p></div></div>:<div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}><thead><tr><th align="left">County</th><th align="left">Organization</th><th align="left">Role</th><th align="left">Name</th><th align="left">Title</th><th align="left">Email</th><th align="left">Phone</th><th align="left">Status</th><th align="left">Source</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} style={{borderTop:'1px solid rgba(127,127,127,.25)'}}><td style={{padding:'10px 8px'}}>{r.county||'STATE'}</td><td style={{padding:'10px 8px'}}>{r.agency_name||'Statewide'}</td><td style={{padding:'10px 8px'}}>{ROLE_LABELS[r.role_key]||r.role_key}</td><td style={{padding:'10px 8px'}}>{r.full_name||'—'}</td><td style={{padding:'10px 8px'}}>{r.title||'—'}</td><td style={{padding:'10px 8px'}}>{r.email||'—'}</td><td style={{padding:'10px 8px'}}>{r.phone||'—'}</td><td style={{padding:'10px 8px',fontWeight:700}}>{r.verification_status.toUpperCase()}</td><td style={{padding:'10px 8px'}}>{r.source_url?<a href={r.source_url} target="_blank" rel="noreferrer">SOURCE</a>:'—'}</td></tr>)}</tbody></table></div>}</section>
  </div></section></main>;
}
