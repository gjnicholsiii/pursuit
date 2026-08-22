import Link from "next/link";
import { Search } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { getSql } from "@/lib/db";
import { RAVEN_VERTICALS, getRavenVertical } from "@/lib/raven-verticals";

export const dynamic = "force-dynamic";

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
  latest_activity: string | null;
};

type CountRow = { total: number | string; with_website: number | string };

export default async function RavenPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const verticalKey = typeof params.vertical === "string" ? params.vertical : "k12";
  const state = typeof params.state === "string" ? params.state.toUpperCase().slice(0, 2) : "";
  const vertical = getRavenVertical(verticalKey);

  let rows: RavenAgencyRow[] = [];
  let counts: CountRow = { total: 0, with_website: 0 };
  let dataError: string | undefined;

  try {
    const organizationTypes = vertical.organizationTypes;
    if (organizationTypes.length) {
      const sql = getSql();
      const where: string[] = [];
      const values: unknown[] = [];
      values.push(organizationTypes);
      where.push(`a.agency_type = any($${values.length}::text[])`);
      if (q) {
        values.push(q);
        where.push(`(a.canonical_name ilike '%' || $${values.length} || '%' or coalesce(a.city,'') ilike '%' || $${values.length} || '%' or coalesce(a.county,'') ilike '%' || $${values.length} || '%')`);
      }
      if (state) {
        values.push(state);
        where.push(`a.state_code = $${values.length}`);
      }
      const clause = where.length ? `where ${where.join(" and ")}` : "";
      const [rawResult, rawCountResult] = await Promise.all([
        sql.query(`
          select
            a.id::text,
            a.canonical_name,
            a.agency_type,
            a.jurisdiction_level,
            a.state_code,
            a.city,
            a.county,
            a.website,
            count(o.id) filter (where o.status='open' and (o.due_at is null or o.due_at >= now()))::int as open_opportunities,
            count(o.id)::int as total_opportunities,
            max(o.last_seen_at)::text as latest_activity
          from agencies a
          left join opportunities o on o.agency_id = a.id
          ${clause}
          group by a.id
          order by count(o.id) filter (where o.status='open' and (o.due_at is null or o.due_at >= now())) desc, a.canonical_name
          limit 100
        `, values),
        sql.query(`select count(*)::int as total, count(*) filter (where website is not null and website <> '')::int as with_website from agencies a ${clause}`, values),
      ]);
      rows = rawResult as unknown as RavenAgencyRow[];
      const countResult = rawCountResult as unknown as CountRow[];
      counts = countResult[0] || counts;
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
            <input name="q" defaultValue={q} placeholder="Search organization, city or county..." style={{ width: "100%", border: 0, background: "transparent", outline: 0, color: "inherit", font: "inherit" }} />
            <input type="hidden" name="vertical" value={vertical.key} />
          </form>
        </header>
        <div className="content">
          <div className="hero-row"><div><span className="eyebrow">RAVEN / MARKET INTELLIGENCE</span><h1>WHO MATTERS. WHY NOW.</h1><p>Search the market by organization, vertical and geography, then connect each buyer to contacts, projects, awards, incumbents and current signals.</p></div></div>

          <section className="readiness-panel">
            <div className="readiness-copy"><span className="eyebrow">VERTICALS</span><h2>Choose the market.</h2><p>Each vertical has its own buying roles and source strategy. Live verticals query Pursuit&apos;s current organization universe now; the remaining universes are being built into the same graph.</p></div>
            <div className="readiness-grid">
              {RAVEN_VERTICALS.map(v => <Link key={v.key} href={buildHref(v.key)} className="readiness-item" style={{ textDecoration: "none" }}><div><strong>{v.label.toUpperCase()} · {v.status.toUpperCase()}</strong><small>{v.buyerRoles.slice(0, 4).join(" · ")}</small></div></Link>)}
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <div><span>{vertical.label.toUpperCase()} INTELLIGENCE</span><h2>{Number(counts.total).toLocaleString()} organizations indexed</h2></div>
              <div><strong>{Number(counts.with_website).toLocaleString()}</strong><small style={{ display: "block" }}>with website data</small></div>
            </div>
            {vertical.organizationTypes.length === 0 ? (
              <div className="readiness-panel"><div className="readiness-copy"><span className="eyebrow">BUILDING</span><h2>{vertical.label} universe</h2><p>{vertical.description}</p><p><strong>Buyer roles:</strong> {vertical.buyerRoles.join(" · ")}</p><p><strong>Sources:</strong> {vertical.sourcePlan.join(" · ")}</p></div></div>
            ) : dataError ? (
              <div className="readiness-panel"><div className="readiness-copy"><h2>Raven data needs attention.</h2><p>{dataError}</p></div></div>
            ) : (
              <div className="opportunity-list">
                {rows.map(row => (
                  <article key={row.id} className="readiness-panel" style={{ marginBottom: 0 }}>
                    <div className="readiness-copy">
                      <span className="eyebrow">{row.agency_type.toUpperCase()} · {row.state_code || "US"}</span>
                      <h2>{row.canonical_name}</h2>
                      <p>{[row.city, row.county].filter(Boolean).join(" · ") || row.jurisdiction_level}</p>
                      <div className="readiness-grid">
                        <div className="readiness-item"><div><strong>{Number(row.open_opportunities).toLocaleString()}</strong><small>Open opportunities</small></div></div>
                        <div className="readiness-item"><div><strong>{Number(row.total_opportunities).toLocaleString()}</strong><small>Total Pursuit activity</small></div></div>
                        <div className="readiness-item"><div><strong>{row.website ? "WEBSITE FOUND" : "DOMAIN PENDING"}</strong><small>{row.website || "Public enrichment queue"}</small></div></div>
                        <div className="readiness-item"><div><strong>BUYERS TO FIND</strong><small>{vertical.buyerRoles.slice(0, 5).join(" · ")}</small></div></div>
                      </div>
                    </div>
                  </article>
                ))}
                {!rows.length && <div className="readiness-panel"><div className="readiness-copy"><h2>No organizations matched this search.</h2><p>Widen the search or switch verticals.</p></div></div>}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
