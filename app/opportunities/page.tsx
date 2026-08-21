import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import { OpportunityCard } from "@/components/opportunity-card";
import { Sidebar } from "@/components/sidebar";
import { getStoredFederalOpportunities, getStoredSledOpportunities } from "@/lib/opportunity-store";
import type { Opportunity } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function stateFromLocation(location: string) {
  const parts = location.split(",").map(part => part.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  return /^[A-Z]{2}$/.test(last) ? last : "";
}

function matchesQuery(opportunity: Opportunity, query: string) {
  if (!query) return true;
  const haystack = [
    opportunity.title,
    opportunity.agency,
    opportunity.location,
    opportunity.procurementPath,
    opportunity.solicitationNumber,
    opportunity.naicsCode,
    opportunity.setAside,
    ...(opportunity.tags || []),
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export default async function OpportunitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = first(params.q).trim();
  const source = first(params.source) || "all";
  const state = first(params.state).toUpperCase();

  let federal: Opportunity[] = [];
  let sled: Opportunity[] = [];
  let dataError: string | undefined;

  try {
    [federal, sled] = await Promise.all([
      getStoredFederalOpportunities(250),
      getStoredSledOpportunities(250),
    ]);
  } catch (error) {
    dataError = error instanceof Error ? error.message : "Unable to read the live opportunity inventory";
  }

  const inventory = [
    ...federal.map(item => ({ ...item, inventorySource: "federal" as const })),
    ...sled.map(item => ({ ...item, inventorySource: "sled" as const })),
  ];

  const states = Array.from(new Set(inventory.map(item => stateFromLocation(item.location)).filter(Boolean))).sort();
  const filtered = inventory.filter(item => {
    if (source !== "all" && item.inventorySource !== source) return false;
    if (state && stateFromLocation(item.location) !== state) return false;
    return matchesQuery(item, query);
  });

  return (
    <main className="shell">
      <Sidebar active="Opportunities" />
      <section className="workspace">
        <header className="topbar">
          <Link href="/opportunities" className="searchbox"><Search size={17} /><span>Search federal, state, local, K-12, higher ed...</span></Link>
        </header>

        <div className="content">
          <div className="hero-row inventory-hero">
            <div>
              <span className="eyebrow">LIVE INVENTORY</span>
              <h1>OPPORTUNITIES</h1>
              <p>{inventory.length.toLocaleString()} current records loaded for search.</p>
            </div>
            <Link href="/" className="secondary-button">Revenue Today</Link>
          </div>

          <form className="opportunity-filters" action="/opportunities" method="get">
            <label className="filter-search">
              <Search size={16} />
              <input name="q" defaultValue={query} placeholder="Agency, keyword, NAICS, solicitation..." />
            </label>
            <label>
              <span>Source</span>
              <select name="source" defaultValue={source}>
                <option value="all">Federal + SLED</option>
                <option value="federal">Federal</option>
                <option value="sled">SLED</option>
              </select>
            </label>
            <label>
              <span>State</span>
              <select name="state" defaultValue={state}>
                <option value="">All states</option>
                {states.map(code => <option key={code} value={code}>{code}</option>)}
              </select>
            </label>
            <button type="submit" className="filter-button"><SlidersHorizontal size={15} />Filter</button>
          </form>

          <div className="inventory-summary">
            <div><strong>{filtered.length.toLocaleString()}</strong><span>matching opportunities</span></div>
            <div><strong>{federal.length.toLocaleString()}</strong><span>federal loaded</span></div>
            <div><strong>{sled.length.toLocaleString()}</strong><span>SLED loaded</span></div>
            {(query || source !== "all" || state) && <Link href="/opportunities">Clear filters</Link>}
          </div>

          {dataError && (
            <section className="readiness-panel">
              <div className="readiness-copy">
                <span className="eyebrow">LIVE DATA</span>
                <h2>Opportunity inventory connection needs attention.</h2>
                <p>{dataError}</p>
              </div>
            </section>
          )}

          <section className="section-block inventory-results">
            <div className="section-heading">
              <div><span>SEARCH RESULTS</span><h2>{filtered.length ? "Current opportunities" : "No matching opportunities"}</h2></div>
            </div>
            {filtered.length > 0 ? (
              <div className="opportunity-list">{filtered.map(item => <OpportunityCard key={item.id} opportunity={item} />)}</div>
            ) : (
              <div className="empty-state">
                <Search size={20} />
                <strong>Nothing matches those filters.</strong>
                <p>Clear one or more filters to widen the live inventory.</p>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
