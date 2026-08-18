import Link from "next/link";
import { Bell, ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { OpportunityCard } from "@/components/opportunity-card";
import { Sidebar } from "@/components/sidebar";
import { opportunities as demoOpportunities } from "@/lib/mock-data";
import {
  getStoredFederalCount,
  getStoredFederalOpportunities,
  getStoredSledCount,
  getStoredSledOpportunities,
} from "@/lib/opportunity-store";
import type { Opportunity } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  let federalOpportunities: Opportunity[] = [];
  let sledOpportunities: Opportunity[] = [];
  let federalCount = 0;
  let sledCount = 0;
  let dataError: string | undefined;

  try {
    [federalOpportunities, sledOpportunities, federalCount, sledCount] = await Promise.all([
      getStoredFederalOpportunities(6),
      getStoredSledOpportunities(6),
      getStoredFederalCount(),
      getStoredSledCount(),
    ]);
  } catch (error) {
    dataError = error instanceof Error ? error.message : "Unable to read the live opportunity inventory";
  }

  const liveOpportunities = [...federalOpportunities, ...sledOpportunities];
  const isLive = liveOpportunities.length > 0;
  const opportunities = isLive ? liveOpportunities : demoOpportunities;
  const averageConfidence = Math.round(opportunities.reduce((sum, item) => sum + item.confidence, 0) / Math.max(opportunities.length, 1));
  const totalCount = federalCount + sledCount;

  return (
    <main className="shell">
      <Sidebar />
      <section className="workspace">
        <header className="topbar">
          <Link href="/opportunities" className="searchbox"><Search size={17} /><span>Search federal, state, local, K-12, higher ed...</span><kbd>⌘ K</kbd></Link>
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
            <MetricCard label="Live opportunities" value={isLive ? totalCount.toLocaleString() : "Waiting"} detail={isLive ? "Current federal + SLED inventory in Pursuit" : "Opportunity inventory is unavailable"} accent />
            <MetricCard label="Federal" value={federalCount.toLocaleString()} detail="Current SAM.gov opportunities" />
            <MetricCard label="SLED" value={sledCount.toLocaleString()} detail="Current public state and local opportunities" />
            <MetricCard label="Brief confidence" value={`${averageConfidence}%`} detail="Metadata confidence; package analysis comes next" />
          </div>

          {dataError && (
            <section className="readiness-panel">
              <div className="readiness-copy">
                <span className="eyebrow">LIVE DATA</span>
                <h2>Opportunity inventory connection needs attention.</h2>
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
            <div className="section-heading"><div><span>{isLive ? "LIVE INVENTORY" : "FIVE-MINUTE BRIEF"}</span><h2>{isLive ? "Federal + SLED opportunities" : "Preview opportunities"}</h2></div><Link href="/opportunities" className="section-link">View all opportunities</Link></div>
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
