import { Bell, CheckCircle2, ChevronDown, CircleAlert, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { OpportunityCard } from "@/components/opportunity-card";
import { Sidebar } from "@/components/sidebar";
import { opportunities, pathToAward, readiness } from "@/lib/mock-data";

export default function Home() {
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
            <MetricCard label="Eligible now" value="27" detail="Based on current selling profile" accent />
            <MetricCard label="Live opportunity value" value="$6.4M" detail="Across reviewed matches" />
            <MetricCard label="Brief confidence" value="91%" detail="Average document coverage" />
            <MetricCard label="Eligibility blockers" value="8" detail="We tell you exactly why" />
          </div>

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
            <div className="section-heading"><div><span>FIVE-MINUTE BRIEF</span><h2>Opportunities worth reviewing</h2></div><button>View all opportunities</button></div>
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
