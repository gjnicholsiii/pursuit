import Link from "next/link";
import { Sidebar } from "@/components/sidebar";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

type ContactRow = {
  id: string;
  state_code: string;
  county: string | null;
  agency_name: string | null;
  scope: string;
  role_key: string;
  full_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  source_url: string | null;
  verification_status: string;
};

const ROLE_LABELS: Record<string,string> = {
  state_security_director: "State Security Director",
  security_director: "Security Director",
  school_board: "School Board",
  superintendent: "Superintendent",
  assistant_superintendent: "Assistant Superintendent",
  it_director: "IT Director",
};

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

export default async function RavenContactsPage({ searchParams }: { searchParams?: Promise<Record<string,string|string[]|undefined>> }) {
  const params = (await searchParams) || {};
  const state = typeof params.state === "string" ? params.state.toUpperCase().slice(0,2) : "AL";
  const sql = getSql();
  let rows: ContactRow[] = [];
  let counts = {verified:0,candidate:0,missing:0,total:0};
  let error: string | null = null;

  try {
    const result = await sql.query(`
      select c.id::text,c.state_code,c.county,a.canonical_name agency_name,c.scope,c.role_key,c.full_name,c.title,c.email,c.phone,c.source_url,c.verification_status
      from raven_state_contacts c
      left join agencies a on a.id=c.agency_id
      where c.state_code=$1
      order by case when c.scope='state' then 0 else 1 end, coalesce(c.county,''), coalesce(a.canonical_name,''),
        case c.role_key when 'state_security_director' then 0 when 'security_director' then 1 when 'superintendent' then 2 when 'assistant_superintendent' then 3 when 'it_director' then 4 else 5 end,
        case c.verification_status when 'verified' then 0 when 'candidate' then 1 when 'missing' then 2 else 3 end,
        coalesce(c.full_name,'')
    `,[state]) as ContactRow[];
    rows = result;
    counts = rows.reduce((acc,row)=>{acc.total++; if(row.verification_status==='verified')acc.verified++; else if(row.verification_status==='candidate')acc.candidate++; else if(row.verification_status==='missing')acc.missing++; return acc;},counts);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unable to load contact review data";
  }

  return <main className="shell">
    <Sidebar active="Raven" />
    <section className="workspace">
      <header className="topbar"><div style={{display:'flex',gap:12,alignItems:'center'}}><Link href="/raven">← Raven</Link><strong>STATE CONTACT REVIEW</strong></div></header>
      <div className="content">
        <div className="hero-row"><div><span className="eyebrow">RAVEN / PRE-SEND REVIEW</span><h1>{state} SECURITY CONTACT DATABASE</h1><p>Only verified contacts become eligible for outreach. Facilities, plant, maintenance and generic operations roles are excluded.</p></div></div>

        <section className="readiness-panel"><div className="readiness-copy"><span className="eyebrow">STATE</span><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{STATES.map(s=><Link key={s} href={`/raven/contacts?state=${s}`} style={{fontWeight:s===state?800:500}}>{s}</Link>)}</div></div></section>

        <section className="section-block">
          <div className="section-heading"><div><span>REVIEW STATUS</span><h2>{counts.total.toLocaleString()} records / slots</h2></div><div><strong>{counts.verified} VERIFIED · {counts.candidate} CANDIDATES · {counts.missing} MISSING</strong><small style={{display:'block'}}>Nothing sends from this page.</small></div></div>
          {error ? <div className="readiness-panel"><div className="readiness-copy"><h2>Database setup pending</h2><p>{error}</p></div></div> :
          <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}><thead><tr><th align="left">County</th><th align="left">Organization</th><th align="left">Role</th><th align="left">Name</th><th align="left">Title</th><th align="left">Email</th><th align="left">Phone</th><th align="left">Status</th><th align="left">Source</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} style={{borderTop:'1px solid rgba(127,127,127,.25)'}}><td style={{padding:'10px 8px'}}>{r.county||'STATE'}</td><td style={{padding:'10px 8px'}}>{r.agency_name||'Statewide'}</td><td style={{padding:'10px 8px'}}>{ROLE_LABELS[r.role_key]||r.role_key}</td><td style={{padding:'10px 8px'}}>{r.full_name||'—'}</td><td style={{padding:'10px 8px'}}>{r.title||'—'}</td><td style={{padding:'10px 8px'}}>{r.email||'—'}</td><td style={{padding:'10px 8px'}}>{r.phone||'—'}</td><td style={{padding:'10px 8px',fontWeight:700}}>{r.verification_status.toUpperCase()}</td><td style={{padding:'10px 8px'}}>{r.source_url?<a href={r.source_url} target="_blank" rel="noreferrer">SOURCE</a>:'—'}</td></tr>)}</tbody></table></div>}
        </section>
      </div>
    </section>
  </main>;
}
