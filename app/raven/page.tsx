import { Search } from "lucide-react";
import { Sidebar } from "@/components/sidebar";

export default function RavenPage() {
  return (
    <main className="shell">
      <Sidebar active="Raven" />
      <section className="workspace">
        <header className="topbar">
          <div className="searchbox"><Search size={17} /><span>Search organizations, people, titles, verticals, systems, awards and incumbents...</span></div>
        </header>
        <div className="content">
          <div className="hero-row"><div><span className="eyebrow">RAVEN / MARKET INTELLIGENCE</span><h1>WHO MATTERS. WHY NOW.</h1><p>Raven is Pursuit&apos;s searchable intelligence database for organizations, decision makers, buying roles, vendors, awards, projects, relationships and current commercial signals.</p></div></div>
          <section className="readiness-panel">
            <div className="readiness-copy"><span className="eyebrow">SEARCH THE MARKET</span><h2>Start with the buyer, vertical, company or signal.</h2><p>Raven is designed to answer precise commercial questions across education, enterprise, retail, healthcare, hospitality and government markets.</p></div>
            <div className="readiness-grid">
              <div className="readiness-item"><div><strong>ORGANIZATIONS</strong><small>Agencies, districts, universities, enterprises, chains, integrators and manufacturers</small></div></div>
              <div className="readiness-item"><div><strong>PEOPLE</strong><small>Owners, presidents, CIOs, IT leaders, facilities, asset protection and board members</small></div></div>
              <div className="readiness-item"><div><strong>RELATIONSHIPS</strong><small>Incumbents, awardees, partners, consultants, specifiers, manufacturers and historical sellers</small></div></div>
              <div className="readiness-item"><div><strong>SIGNALS</strong><small>Projects, awards, hiring, expansion, leadership change, contract history and procurement activity</small></div></div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}