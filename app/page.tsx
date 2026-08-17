import { Bell, CheckCircle2, ChevronDown, CircleAlert, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { OpportunityCard } from "@/components/opportunity-card";
import { Sidebar } from "@/components/sidebar";
import { opportunities as demoOpportunities, pathToAward, readiness } from "@/lib/mock-data";
import { loadSamOpportunities } from "@/lib/sam";

export default async function Home() {
  const sam = await loadSamOpportunities(12);
  const isLive = sam.configured && !sam.error && sam.opportunities.length > 0;
  const opportunities = isLive ? sam.opportunities : demoOpportunities;
  const averageConfidence = Math.round(opportunities.reduce((sum, item) => sum + item.confidence, 0) / Math.max(opportunities.length, 1));

  return (
    <main className="shell">
      <Sidebar />
      <section className="workspace">
        <header className="topbar">
          <div className="searchbox"><Search size={17} /><span>Search federal, state, local, K-12, higher ed...</span><kbd>⌘ K</kbd></div>
          <div className="top-actions"><button className="icon-button"><Bell size={18} /></button><button className="company-button">Example Company <ChevronDown size={15} /></button></div>
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
            <MetricCard label={isLive ? "Federal records" : "Federal feed"} value={isLive ? sam.totalRecords.toLocaleString() : "Waiting"} detail={isLive ? "Solicitations posted in the last 14 days" : "Add SAM_GOV_API_KEY to Vercel"} accent />
            <MetricCard label={isLive ? "Loaded now" : "Preview records"} value={String(opportunities.length)} detail={isLive ? "Current live SAM.gov sample" : "Demo data until the federal feed is connected"} />
            <MetricCard label="Brief confidence" value={`${averageConfidence}%`} detail={isLive ? "Metadata confidence; package analysis comes next" : "Prototype scoring"} />
            <MetricCard label="SLED coverage" value="Next" detail="National SLED feed follows the federal vertical slice" />
          </div>

          {sam.error && (
            <section className="readiness-panel">
              <div className="readiness-copy">
                <span className="eyebrow">FEDERAL FEED</span>
                <h2>SAM.gov is configured but did not return data.</h2>
                <p>{sam.error}. Pursuit is showing demo records so the product remains usable while the connection is fixed.</p>
              </div>
            </section>
          )}

          <section className="readiness-panel">
            <div className="readiness-copy">
              <span className="eyebrow">READY FOR GOVERNMENT</span>
              <h2>You are ready to compete for 27 opportunities today.</h2>
              <p>Eight additional opportunities require something your current profile does not show.</p>
            </div>
            <div className="readiness-grid">
              {readiness.map(item => (
                <div className="readiness-item" key={item.label}>
                  {item.status === "verified" ? <CheckCircle2 size={16} /> : item.status === "missing" ? <CircleAlert size={16} /> : <ShieldCheck size={16} />}
                  <div><strong>{item.label}</strong><small>{item.detail}</small></div>
                </div>
              ))}
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading"><div><span>{isLive ? "LIVE FEDERAL" : "FIVE-MINUTE BRIEF"}</span><h2>{isLive ? "Recent SAM.gov opportunities" : "Opportunities worth reviewing"}</h2></div><button>View all opportunities</button></div>
            <div className="opportunity-list">{opportunities.map(o => <OpportunityCard key={o.id} opportunity={o} />)}</div>
          </section>

          <section className="path-panel section-block">
            <div className="path-heading">
              <span className="eyebrow">PATH TO AWARD</span>
              <h2>{pathToAward.agency}</h2>
              <p>{pathToAward.opportunity}</p>
            </div>
            <div className="path-mechanism">
              <span>HOW THEY ARE BUYING</span>
              <strong>{pathToAward.mechanism}</strong>
              <p>{pathToAward.explanation}</p>
            </div>
            <div className="path-steps">
              <span>WHAT HAPPENS NEXT</span>
              <ol>{pathToAward.steps.map(step => <li key={step}>{step}</li>)}</ol>
            </div>
            <div className="path-not-needed">
              <span>NOT IDENTIFIED AS REQUIRED</span>
              {pathToAward.doesNotRequire.map(item => <div key={item}><CheckCircle2 size={14} />{item}</div>)}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
