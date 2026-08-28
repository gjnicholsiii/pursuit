import Link from "next/link";
import { Search } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { getSql } from "@/lib/db";
import { RAVEN_VERTICALS, getRavenVertical } from "@/lib/raven-verticals";

export const dynamic = "force-dynamic";

type RavenPerson = {
  full_name: string;
  title: string | null;
  role_family: string | null;
  email: string | null;
  phone: string | null;
  source_url: string | null;
  confidence: number | string;
};

type RavenSignal = {
  title: string;
  source_url: string | null;
  due_at: string | null;
  occurred_at: string | null;
  status: string;
  kind: string;
  excerpt: string | null;
};

type RavenAgencyRow = {
  id: string;
  canonical_name: string;
  agency_type: string;
  jurisdiction_level: string;
  state_code: string | null;
  city: string | null;
  county: string | null;
  website: string | null;
  open_opportunities: number | string;
  total_opportunities: number | string;
  people_count: number | string;
  decision_makers: RavenPerson[] | null;
  recent_signals: RavenSignal[] | null;
};

type CountRow = {
  total: number | string;
  with_website: number | string;
  enriched: number | string;
  people: number | string;
};

const SIGNAL_LABELS: Record<string, string> = {
  board_meeting: "BOARD / AGENDA",
  budget: "BUDGET",
  bond: "BOND",
  capital_plan: "CAPITAL / FACILITIES",
  safety_plan: "SAFETY / SECURITY",
  active_solicitation: "ACTIVE SOLICITATION",
  public_signal: "PUBLIC SIGNAL",
};

function signalDate(signal: RavenSignal) {
  const value = signal.due_at || signal.occurred_at;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return signal.due_at
    ? `Due ${date.toLocaleDateString("en-US")}`
    : `Seen ${date.toLocaleDateString("en-US")}`;
}

export default async function RavenPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) || {};
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const verticalKey = typeof params.vertical === "string" ? params.vertical : "k12";
  const state = typeof params.state === "string" ? params.state.toUpperCase().slice(0, 2) : "";
  const vertical = getRavenVertical(verticalKey);

  let rows: RavenAgencyRow[] = [];
  let counts: CountRow = { total: 0, with_website: 0, enriched: 0, people: 0 };
  let dataError: string | undefined;

  try {
    const organizationTypes = vertical.organizationTypes;
    if (organizationTypes.length) {
      const sql = getSql();
      const where: string[] = [];
      const values: unknown[] = [organizationTypes];
      where.push(`a.agency_type = any($1::text[])`);

      if (q) {
        values.push(q);
        const p = `$${values.length}`;
        where.push(`(
          a.canonical_name ilike '%'||${p}||'%'
          or coalesce(a.city,'') ilike '%'||${p}||'%'
          or coalesce(a.county,'') ilike '%'||${p}||'%'
          or exists(select 1 from raven_people rp where rp.agency_id=a.id and (rp.full_name ilike '%'||${p}||'%' or coalesce(rp.title,'') ilike '%'||${p}||'%' or coalesce(rp.email,'') ilike '%'||${p}||'%'))
          or exists(select 1 from raven_relationships rr where rr.agency_id=a.id and rr.relationship_type='buying_signal' and (coalesce(rr.related_name,'') ilike '%'||${p}||'%' or coalesce(rr.evidence->>'excerpt','') ilike '%'||${p}||'%'))
          or exists(select 1 from opportunities oq where oq.agency_id=a.id and (oq.title ilike '%'||${p}||'%' or coalesce(oq.solicitation_number,'') ilike '%'||${p}||'%'))
        )`);
      }

      if (state) {
        values.push(state);
        where.push(`a.state_code=$${values.length}`);
      }

      const clause = `where ${where.join(" and ")}`;
      const dataSql = `
        with signal_stats as (
          select agency_id, count(*)::int signal_count, max(last_seen_at) last_signal
          from raven_relationships
          where relationship_type='buying_signal'
          group by agency_id
        ), people_stats as (
          select agency_id, count(*)::int people_count
          from raven_people
          group by agency_id
        ), opp_stats as (
          select agency_id,
            count(*)::int total_opportunities,
            count(*) filter(where status='open' and (due_at is null or due_at>=now()))::int open_opportunities,
            max(last_seen_at) latest_activity
          from opportunities
          group by agency_id
        ), candidates as (
          select a.id,a.canonical_name,a.agency_type,a.jurisdiction_level,a.state_code,a.city,a.county,a.website,
            coalesce(ss.signal_count,0)::int signal_count,
            coalesce(ps.people_count,0)::int people_count,
            coalesce(os.open_opportunities,0)::int open_opportunities,
            coalesce(os.total_opportunities,0)::int total_opportunities,
            os.latest_activity
          from agencies a
          left join signal_stats ss on ss.agency_id=a.id
          left join people_stats ps on ps.agency_id=a.id
          left join opp_stats os on os.agency_id=a.id
          ${clause}
          order by coalesce(ss.signal_count,0) desc, coalesce(ps.people_count,0) desc,
            coalesce(os.open_opportunities,0) desc, greatest(ss.last_signal,os.latest_activity) desc nulls last,
            a.canonical_name
          limit 60
        )
        select c.id::text,c.canonical_name,c.agency_type,c.jurisdiction_level,c.state_code,c.city,c.county,c.website,
          c.open_opportunities,c.total_opportunities,c.people_count,
          coalesce(people.items,'[]'::jsonb) decision_makers,
          coalesce(signals.items,'[]'::jsonb) recent_signals
        from candidates c
        left join lateral (
          select jsonb_agg(jsonb_build_object(
            'full_name',p.full_name,'title',p.title,'role_family',p.role_family,'email',p.email,
            'phone',p.phone,'source_url',p.source_url,'confidence',p.confidence
          ) order by p.confidence desc,p.full_name) items
          from (
            select rp.full_name,rp.title,rp.role_family,rp.email,rp.phone,rp.source_url,rp.confidence
            from raven_people rp
            where rp.agency_id=c.id
              and rp.role_family in ('Security','Technology','Facilities','Procurement','Executive','Board')
            order by rp.confidence desc,rp.full_name
            limit 6
          ) p
        ) people on true
        left join lateral (
          select jsonb_agg(jsonb_build_object(
            'title',s.title,'source_url',s.source_url,'due_at',s.due_at,'occurred_at',s.occurred_at,
            'status',s.status,'kind',s.kind,'excerpt',s.excerpt
          ) order by s.event_at desc) items
          from (
            select * from (
              select rr.related_name title,rr.related_url source_url,null::text due_at,rr.last_seen_at::text occurred_at,
                'signal'::text status,coalesce(rr.evidence->>'signal_type','public_signal') kind,
                nullif(rr.evidence->>'excerpt','') excerpt,rr.last_seen_at event_at
              from raven_relationships rr
              where rr.agency_id=c.id and rr.relationship_type='buying_signal'
              union all
              select o.title,o.source_url,o.due_at::text,o.last_seen_at::text,o.status,'active_solicitation'::text,
                null::text,o.last_seen_at
              from opportunities o
              where o.agency_id=c.id and o.status='open' and (o.due_at is null or o.due_at>=now())
            ) u order by event_at desc limit 6
          ) s
        ) signals on true
        order by c.signal_count desc,c.people_count desc,c.open_opportunities desc,c.canonical_name`;

      const countSql = `
        select count(*)::int total,
          count(*) filter(where a.website is not null and a.website<>'')::int with_website,
          count(*) filter(where exists(select 1 from raven_people rp where rp.agency_id=a.id))::int enriched,
          (select count(*)::int from raven_people rp join agencies ax on ax.id=rp.agency_id where ax.agency_type=any($1::text[])) people
        from agencies a ${clause}`;

      const [rawResult, rawCountResult] = await Promise.all([
        sql.query(dataSql, values),
        sql.query(countSql, values),
      ]);
      rows = rawResult as RavenAgencyRow[];
      counts = (rawCountResult as CountRow[])[0] || counts;
    }
  } catch (error) {
    dataError = error instanceof Error ? error.message : "Unable to load Raven";
  }

  const buildHref = (key: string) => `/raven?vertical=${encodeURIComponent(key)}`;

  return (
    <main className="shell">
      <Sidebar active="Raven" />
      <section className="workspace">
        <header className="topbar">
          <form className="searchbox" action="/raven" method="get">
            <Search size={17} />
            <input name="q" defaultValue={q} placeholder="Search organization, buyer, trigger, email or solicitation..." style={{ width: "100%", border: 0, background: "transparent", outline: 0, color: "inherit", font: "inherit" }} />
            <input type="hidden" name="vertical" value={vertical.key} />
          </form>
        </header>

        <div className="content">
          <div className="hero-row"><div>
            <span className="eyebrow">RAVEN / MARKET INTELLIGENCE</span>
            <h1>WHO MATTERS. WHY NOW.</h1>
            <p>Decision-makers plus the public evidence that explains why an organization deserves attention now.</p>
          </div></div>

          <section className="readiness-panel">
            <div className="readiness-copy"><span className="eyebrow">VERTICALS</span><h2>Choose the market.</h2><p>Live verticals search organizations, buyers, public buying signals and procurement activity together.</p></div>
            <div className="readiness-grid">
              {RAVEN_VERTICALS.map((v) => (
                <Link key={v.key} href={buildHref(v.key)} className="readiness-item" style={{ textDecoration: "none" }}>
                  <div><strong>{v.label.toUpperCase()} · {v.status.toUpperCase()}</strong><small>{v.buyerRoles.slice(0, 4).join(" · ")}</small></div>
                </Link>
              ))}
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <div><span>{vertical.label.toUpperCase()} INTELLIGENCE</span><h2>{Number(counts.total).toLocaleString()} organizations indexed</h2></div>
              <div><strong>{Number(counts.enriched).toLocaleString()} enriched · {Number(counts.people).toLocaleString()} people</strong><small style={{ display: "block" }}>{Number(counts.with_website).toLocaleString()} organizations with website data</small></div>
            </div>

            {vertical.organizationTypes.length === 0 ? (
              <div className="readiness-panel"><div className="readiness-copy"><span className="eyebrow">BUILDING</span><h2>{vertical.label} universe</h2><p>{vertical.description}</p><p><strong>Buyer roles:</strong> {vertical.buyerRoles.join(" · ")}</p><p><strong>Sources:</strong> {vertical.sourcePlan.join(" · ")}</p></div></div>
            ) : dataError ? (
              <div className="readiness-panel"><div className="readiness-copy"><h2>Raven data needs attention.</h2><p>{dataError}</p></div></div>
            ) : rows.length === 0 ? (
              <div className="readiness-panel"><div className="readiness-copy"><h2>No Raven matches.</h2><p>Try another search or vertical.</p></div></div>
            ) : (
              <div className="opportunity-list">
                {rows.map((row) => {
                  const people = Array.isArray(row.decision_makers) ? row.decision_makers : [];
                  const signals = Array.isArray(row.recent_signals) ? row.recent_signals : [];
                  return (
                    <article key={row.id} className="readiness-panel" style={{ marginBottom: 0 }}><div className="readiness-copy">
                      <span className="eyebrow">{row.agency_type.toUpperCase()} · {row.state_code || "US"}</span>
                      <h2>{row.canonical_name}</h2>
                      <p>{[row.city, row.county].filter(Boolean).join(" · ") || row.jurisdiction_level}</p>
                      <div className="readiness-grid">
                        <div className="readiness-item"><div><strong>{Number(row.open_opportunities).toLocaleString()}</strong><small>Open opportunities</small></div></div>
                        <div className="readiness-item"><div><strong>{Number(row.total_opportunities).toLocaleString()}</strong><small>Total Pursuit activity</small></div></div>
                        <div className="readiness-item"><div><strong>{Number(row.people_count).toLocaleString()} BUYERS</strong><small>{people.length ? "Public contacts found" : "Public enrichment queue"}</small></div></div>
                        <div className="readiness-item"><div><strong>{row.website ? "WEBSITE FOUND" : "DOMAIN PENDING"}</strong><small>{row.website || "Public enrichment queue"}</small></div></div>
                      </div>

                      {signals.length > 0 && <div style={{ marginTop: 14 }}>
                        <span className="eyebrow">WHY NOW / SOURCED TRIGGERS</span>
                        <div className="readiness-grid">{signals.map((signal, index) => (
                          <div className="readiness-item" key={`${signal.kind}-${signal.title}-${index}`}><div>
                            <small>{SIGNAL_LABELS[signal.kind] || signal.kind.replaceAll("_", " ").toUpperCase()}</small>
                            <strong>{signal.title}</strong>
                            {signal.excerpt && signal.excerpt !== signal.title ? <small>{signal.excerpt}</small> : null}
                            {signalDate(signal) ? <small>{signalDate(signal)}</small> : null}
                            {signal.source_url ? <a href={signal.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>VIEW EVIDENCE</a> : null}
                          </div></div>
                        ))}</div>
                      </div>}

                      {people.length > 0 ? <div style={{ marginTop: 14 }}>
                        <span className="eyebrow">WHO MATTERS</span>
                        <div className="readiness-grid">{people.map((person, index) => (
                          <div className="readiness-item" key={`${person.full_name}-${index}`}><div>
                            <strong>{person.full_name}</strong><small>{person.title || person.role_family || "Decision maker"}</small>
                            <small>{person.email || person.phone || `Confidence ${person.confidence}%`}</small>
                            {person.source_url ? <a href={person.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>SOURCE</a> : null}
                          </div></div>
                        ))}</div>
                      </div> : <div className="readiness-item" style={{ marginTop: 14 }}><div><strong>BUYERS PENDING</strong><small>Public enrichment is still running for this organization.</small></div></div>}
                    </div></article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
