import Link from "next/link";
import { Search } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { OpportunityCard } from "@/components/opportunity-card";
import { Sidebar } from "@/components/sidebar";
import { opportunities as demoOpportunities } from "@/lib/mock-data";
import {
  getStoredFederalCount,
  getStoredFederalOpportunities,
  getStoredSledCount,
  getStoredSledMarketCounts,
  getStoredSledOpportunities,
} from "@/lib/opportunity-store";
import type { Opportunity } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  let federalOpportunities: Opportunity[] = [];
  let sledOpportunities: Opportunity[] = [];
  let federalCount = 0;
  let sledCount = 0;
  let k12Count = 0;
  let higherEdCount = 0;
  let stateCount = 0;
  let localCount = 0;
  let authorityCount = 0;
  let dataError: string | undefined;

  try {
    const [federalItems, sledItems, federalTotal, sledTotal, marketCounts] = await Promise.all([
      getStoredFederalOpportunities(6), getStoredSledOpportunities(6), getStoredFederalCount(), getStoredSledCount(), getStoredSledMarketCounts(),
    ]);
    federalOpportunities = federalItems;
    sledOpportunities = sledItems;
    federalCount = federalTotal;
    sledCount = sledTotal;
    k12Count = marketCounts.k12;
    higherEdCount = marketCounts.higherEd;
    stateCount = marketCounts.state;
    localCount = marketCounts.local;
    authorityCount = marketCounts.authorities;
  } catch (error) {
    dataError = error instanceof Error ? error.message : "Unable to read the live opportunity inventory";
  }

  const liveOpportunities = [...federalOpportunities, ...sledOpportunities];
  const isLive = liveOpportunities.length > 0;
  const opportunities = isLive ? liveOpportunities : demoOpportunities;
  const totalCount = federalCount + sledCount;

  return (
    <main className="shell">
      <Sidebar />
      <section className="workspace">
        <header className="topbar">
          <Link href="/opportunities" className="searchbox"><Search size={17} /><span>Search federal, state, local, K-12, higher ed...</span><kbd>⌘ K</kbd></Link>
        </header>

        <div className="content">
          <div className="hero-row">
            <div><span className="eyebrow">REVENUE TODAY</span><h1>WIN MORE / WORK LESS</h1><p>Federal, state, local, K-12 and higher education opportunities in one live inventory.</p></div>
          </div>

          <div className="metrics">
            <MetricCard label="Live opportunities" value={isLive ? totalCount.toLocaleString() : "Waiting"} detail={isLive ? "Current government opportunity inventory in Pursuit" : "Opportunity inventory is unavailable"} accent />
            <MetricCard label="Federal" value={federalCount.toLocaleString()} detail="Current SAM.gov opportunities" />
            <MetricCard label="K-12" value={k12Count.toLocaleString()} detail="School districts and public K-12 buyers" />
            <MetricCard label="Higher Education" value={higherEdCount.toLocaleString()} detail="Public colleges and universities" />
          </div>

          <section className="readiness-panel">
            <div className="readiness-copy"><span className="eyebrow">MARKET COVERAGE</span><h2>Government is bigger than federal.</h2><p>Pursuit tracks state agencies, cities, counties, school districts, colleges, universities and authorities alongside federal opportunities.</p></div>
            <div className="readiness-grid">
              <div className="readiness-item"><div><strong>K-12</strong><small>{k12Count.toLocaleString()} live opportunities</small></div></div>
              <div className="readiness-item"><div><strong>Higher Education</strong><small>{higherEdCount.toLocaleString()} live opportunities</small></div></div>
              <div className="readiness-item"><div><strong>State Agencies</strong><small>{stateCount.toLocaleString()} live opportunities</small></div></div>
              <div className="readiness-item"><div><strong>Local + County</strong><small>{localCount.toLocaleString()} live opportunities</small></div></div>
              <div className="readiness-item"><div><strong>Authorities</strong><small>{authorityCount.toLocaleString()} live opportunities</small></div></div>
              <div className="readiness-item"><div><strong>SLED Total</strong><small>{sledCount.toLocaleString()} live opportunities</small></div></div>
            </div>
          </section>

          {dataError && <section className="readiness-panel"><div className="readiness-copy"><span className="eyebrow">LIVE DATA</span><h2>Opportunity inventory connection needs attention.</h2><p>{dataError}. Pursuit is showing clearly marked preview records while the connection is checked.</p></div></section>}

          <section className="section-block">
            <div className="section-heading"><div><span>{isLive ? "LIVE INVENTORY" : "PREVIEW"}</span><h2>{isLive ? "Federal + SLED opportunities" : "Preview opportunities"}</h2></div><Link href="/opportunities" className="section-link">View all opportunities</Link></div>
            <div className="opportunity-list">{opportunities.map(o => <OpportunityCard key={o.id} opportunity={o} />)}</div>
          </section>

          <section className="path-panel section-block"><div className="path-heading"><span className="eyebrow">PATH TO AWARD</span><h2>Choose an opportunity.</h2><p>Pursuit shows how the agency is buying, the requirements found in source documents, source evidence and the next action.</p></div></section>
        </div>
      </section>
    </main>
  );
}
