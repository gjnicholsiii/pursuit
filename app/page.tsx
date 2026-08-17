import { Bell, ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { OpportunityCard } from "@/components/opportunity-card";
import { Sidebar } from "@/components/sidebar";
import { opportunities as demoOpportunities } from "@/lib/mock-data";
import { getStoredFederalCount, getStoredFederalOpportunities } from "@/lib/opportunity-store";
import type { Opportunity } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  let storedOpportunities: Opportunity[] = [];
  let storedCount = 0;
  let dataError: string | undefined;

  try {
    [storedOpportunities, storedCount] = await Promise.all([
      getStoredFederalOpportunities(12),
      getStoredFederalCount(),
    ]);
  } catch (error) {
    dataError = error instanceof Error ? error.message : "Unable to read stored federal opportunities";
  }

  const isLive = storedOpportunities.length > 0;
  const opportunities = isLive ? storedOpportunities : demoOpportunities;
  const averageConfidence = Math.round(opportunities.reduce((sum, item) => sum + item.confidence, 0) / Math.max(opportunities.length, 1));

  return (
    <main className="shell">
      <Sidebar />
      <section className="workspace">
        <header className="topbar">
          <div className="searchbox"><Search size={17} /><span>Search federal, state, local, K-12, higher ed...</span><kbd>⌘ K</kbd></div>
          <div className="top-actions"><button className="icon-button"><Bell size={18} /></button><button className="company-button">Set up company <ChevronDown size={15} /></button></div>
        </header>

        <div className="content">
          <div className="hero-row">
            <div>
              <span className="eyebrow">REVENUE TODAY</span>
              <h1>WIN MORE / WORK LESS</h1>
              <p>Federal + SLED.</p>
            </div>
            <button className="secondary-button"><SlidersHorizontal size={16} />Selling profile</button>
          </div>

          <div className="metrics">
            <MetricCard label={isLive ? "Federal opportunities" : "Federal feed"} value={isLive ? storedCount.toLocaleString() : "Waiting"} detail={isLive ? "Open notices with a future or unstated response deadline" : "Federal inventory is unavailable"} accent />
            <MetricCard label={isLive ? "Loaded now" : "Preview records"} value={String(opportunities.length)} detail={isLive ? "Current records served from Neon" : "Demo records while the federal feed is unavailable"} />
            <MetricCard label="Brief confidence" value={`${averageConfidence}%`} detail={isLive ? "Metadata confidence; package analysis comes next" : "Prototype scoring"} />
            <MetricCard label="SLED coverage" value="Next" detail="National SLED feed follows the federal vertical slice" />
          </div>

          {dataError && (
            <section className="readiness-panel">
              <div className="readiness-copy">
                <span className="eyebrow">FEDERAL DATA</span>
                <h2>Federal inventory connection needs attention.</h2>
                <p>{dataError}. Pursuit is showing clearly marked preview records while the connection is checked.</p>
              </div>
            </section>
          )}

          <section className="readiness-panel">
            <div className="readiness-copy">
              <span className="eyebrow">READY FOR GOVERNMENT</span>
              <h2>Tell Pursuit what you sell.</h2>
              <p>Add territories, NAICS codes, registrations, certifications and contract vehicles. Pursuit will compare your profile against the live inventory and show READY / REVIEW / BLOCKED with source evidence.</p>
            </div>
            <button className="secondary-button"><SlidersHorizontal size={16} />Build selling profile</button>
          </section>

          <section className="section-block">
            <div className="section-heading"><div><span>{isLive ? "FEDERAL INVENTORY" : "FIVE-MINUTE BRIEF"}</span><h2>{isLive ? "Current SAM.gov opportunities" : "Preview opportunities"}</h2></div><button>View all opportunities</button></div>
            <div className="opportunity-list">{opportunities.map(o => <OpportunityCard key={o.id} opportunity={o} />)}</div>
          </section>

          <section className="path-panel section-block">
            <div className="path-heading">
              <span className="eyebrow">PATH TO AWARD</span>
              <h2>Choose an opportunity.</h2>
              <p>Pursuit will show how the agency is buying, the requirements that matter, source evidence, blockers and the next action.</p>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
