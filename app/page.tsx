import Link from "next/link";
import { Search } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { OpportunityCard } from "@/components/opportunity-card";
import { Sidebar } from "@/components/sidebar";
import { getCurrentCustomerProfile, getCustomerMatches } from "@/lib/customer-profile";
import { getStoredFederalOpportunities, getStoredSledOpportunities } from "@/lib/opportunity-store";
import { getSql } from "@/lib/db";
import type { CustomerProfile } from "@/lib/customer-profile";
import type { Opportunity } from "@/lib/types";

export const dynamic = "force-dynamic";

interface ProofRow {
  open_total: number | string;
  federal_open: number | string;
  sled_open: number | string;
  k12_agencies: number | string;
}

export default async function Home() {
  let dataError: string | undefined;
  let profile: CustomerProfile | null = null;
  let opportunities: Opportunity[] = [];
  let demoOpportunities: Opportunity[] = [];
  let proof: ProofRow = { open_total: 0, federal_open: 0, sled_open: 0, k12_agencies: 0 };

  try {
    profile = await getCurrentCustomerProfile();
    if (profile) {
      opportunities = await getCustomerMatches(profile, { limit: 12, threshold: 45 });
    } else {
      const [federal, sled, proofRowsRaw] = await Promise.all([
        getStoredFederalOpportunities(2),
        getStoredSledOpportunities(3),
        getSql().query(`
          select
            count(*) filter (where o.status = 'open' and (o.due_at is null or o.due_at >= now()))::int as open_total,
            count(*) filter (where o.status = 'open' and (o.due_at is null or o.due_at >= now()) and s.adapter_key = 'sam_gov')::int as federal_open,
            count(*) filter (where o.status = 'open' and (o.due_at is null or o.due_at >= now()) and s.source_family = 'sled')::int as sled_open,
            (select count(*)::int from agencies where agency_type = 'k12') as k12_agencies
          from opportunities o
          join sources s on s.id = o.source_id
        `),
      ]);
      const proofRows = proofRowsRaw as unknown as ProofRow[];
      demoOpportunities = [...federal, ...sled].slice(0, 5);
      proof = proofRows[0] || proof;
    }
  } catch (error) {
    dataError = error instanceof Error ? error.message : "Unable to load Pursuit";
  }

  const topMatch = opportunities.length ? Math.max(...opportunities.map(item => item.matchScore || 0)) : 0;
  const excellentMatches = opportunities.filter(item => (item.matchScore || 0) >= 80).length;
  const averageConfidence = opportunities.length
    ? Math.round(opportunities.reduce((sum, item) => sum + item.confidence, 0) / opportunities.length)
    : 0;
  const codeCount = profile ? profile.naicsCodes.length + profile.pscCodes.length : 0;

  return (
    <main className="shell">
      <Sidebar />
      <section className="workspace">
        <header className="topbar">
          <Link href={profile ? "/opportunities?scope=matches" : "/opportunities?scope=all"} className="searchbox">
            <Search size={17} />
            <span>{profile ? "Search your matches, or widen to all Pursuit..." : "Search live federal, state, local and education opportunities..."}</span>
          </Link>
        </header>

        <div className="content">
          {!profile ? (
            <>
              <div className="hero-row">
                <div>
                  <span className="eyebrow">GOVERNMENT REVENUE INTELLIGENCE</span>
                  <h1>WIN MORE / WORK LESS</h1>
                  <p>Government opportunities worth pursuing, ranked for your company. Pursuit searches federal, state, local, K-12, higher education, agencies and authorities, then tells you which opportunities fit, why they fit, what the solicitation requires and how reliable the underlying information is.</p>
                </div>
                <Link href="/profile" className="secondary-button">Build my opportunity feed</Link>
              </div>

              <div className="metrics">
                <MetricCard label="Open opportunities" value={Number(proof.open_total).toLocaleString()} detail="Live opportunities currently searchable in Pursuit" accent />
                <MetricCard label="Federal" value={Number(proof.federal_open).toLocaleString()} detail="Current SAM.gov opportunities" />
                <MetricCard label="SLED" value={Number(proof.sled_open).toLocaleString()} detail="State, local and education opportunities" />
                <MetricCard label="K-12 agencies" value={Number(proof.k12_agencies).toLocaleString()} detail="District and education entities indexed" />
              </div>

              <section className="readiness-panel">
                <div className="readiness-copy">
                  <span className="eyebrow">FROM BID LIST TO DECISION</span>
                  <h2>Most bid sites give you a list. Pursuit gives you a decision-ready feed.</h2>
                  <p>Match tells you whether an opportunity fits your company. Confidence tells you how complete and reliable the information is. The Five-Minute Brief turns the solicitation package into the facts you need to decide what deserves your time.</p>
                </div>
                <div className="readiness-grid">
                  <div className="readiness-item"><div><strong>MATCH SCORE</strong><small>Codes, capabilities, geography and target value are evaluated against your profile</small></div></div>
                  <div className="readiness-item"><div><strong>WHY IT MATCHES</strong><small>Exact reasons instead of a mystery recommendation</small></div></div>
                  <div className="readiness-item"><div><strong>CONFIDENCE SCORE</strong><small>Separate measure of source and package completeness</small></div></div>
                  <div className="readiness-item"><div><strong>FIVE-MINUTE BRIEF</strong><small>Requirements, deadlines, forms, set-asides and submission facts</small></div></div>
                  <div className="readiness-item"><div><strong>PACKAGE WATCH</strong><small>Changes, amendments and missing documents surfaced</small></div></div>
                  <div className="readiness-item"><div><strong>SOURCE EVIDENCE</strong><small>Original procurement evidence remains one click away</small></div></div>
                </div>
              </section>

              <section className="section-block">
                <div className="section-heading">
                  <div><span>LIVE IN PURSUIT NOW</span><h2>Real opportunities. One national market.</h2></div>
                  <Link href="/opportunities?scope=all" className="section-link">Search all opportunities</Link>
                </div>
                {demoOpportunities.length > 0 ? (
                  <div className="opportunity-list">{demoOpportunities.map(item => <OpportunityCard key={item.id} opportunity={item} />)}</div>
                ) : (
                  <div className="readiness-panel"><div className="readiness-copy"><h2>Live inventory is loading.</h2><p>{dataError || "Pursuit is connecting to the current opportunity inventory."}</p></div></div>
                )}
              </section>

              <section className="readiness-panel">
                <div className="readiness-copy">
                  <span className="eyebrow">MAKE PURSUIT YOURS</span>
                  <h2>You do not need more bids. You need fewer irrelevant ones.</h2>
                  <p>Tell Pursuit what you sell, where you sell it, your NAICS and PSC codes, certifications and target contract size. Your homepage becomes a ranked revenue feed built around your company.</p>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                  <Link href="/profile" className="secondary-button">Build my opportunity feed</Link>
                </div>
              </section>
            </>
          ) : (
            <>
              <div className="hero-row">
                <div>
                  <span className="eyebrow">YOUR OPPORTUNITIES</span>
                  <h1>REVENUE TODAY</h1>
                  <p>{profile.organizationName}. Ranked by how closely each live opportunity fits your selling profile.</p>
                </div>
                <Link href="/profile" className="secondary-button">Edit selling profile</Link>
              </div>

              <div className="metrics">
                <MetricCard label="Top match" value={`${topMatch}%`} detail="Best customer-fit score in your current feed" accent />
                <MetricCard label="Excellent fits" value={excellentMatches.toLocaleString()} detail="80%+ matches in the opportunities shown below" />
                <MetricCard label="Information confidence" value={`${averageConfidence}%`} detail="Average source/package confidence for the opportunities shown" />
                <MetricCard label="Codes tracked" value={codeCount.toLocaleString()} detail={`${profile.naicsCodes.length} NAICS · ${profile.pscCodes.length} PSC`} />
              </div>

              <section className="readiness-panel">
                <div className="readiness-copy">
                  <span className="eyebrow">HOW TO READ THE PERCENTAGES</span>
                  <h2>Match and Confidence answer different questions.</h2>
                  <p><strong>Match</strong> measures fit to your company. <strong>Confidence</strong> measures how complete and reliable Pursuit&apos;s information is. Neither is a probability of winning.</p>
                </div>
                <div className="readiness-grid">
                  <div className="readiness-item"><div><strong>NAICS + PSC</strong><small>{[...profile.naicsCodes, ...profile.pscCodes].join(", ") || "Not configured"}</small></div></div>
                  <div className="readiness-item"><div><strong>Capabilities</strong><small>{profile.capabilityTerms.slice(0, 4).join(" · ") || "Not configured"}</small></div></div>
                  <div className="readiness-item"><div><strong>Territories</strong><small>{profile.territories.join(", ") || "Not configured"}</small></div></div>
                  <div className="readiness-item"><div><strong>Match floor</strong><small>Homepage shows 45%+ profile matches</small></div></div>
                </div>
              </section>

              {dataError && (
                <section className="readiness-panel"><div className="readiness-copy"><span className="eyebrow">LIVE DATA</span><h2>Your feed needs attention.</h2><p>{dataError}</p></div></section>
              )}

              <section className="section-block">
                <div className="section-heading">
                  <div><span>RANKED FOR YOU</span><h2>Best current matches</h2></div>
                  <Link href="/opportunities?scope=matches" className="section-link">Search your matches</Link>
                </div>
                {opportunities.length > 0 ? (
                  <div className="opportunity-list">{opportunities.map(item => <OpportunityCard key={item.id} opportunity={item} />)}</div>
                ) : (
                  <div className="readiness-panel"><div className="readiness-copy"><h2>No opportunities currently clear your match threshold.</h2><p>Edit your selling profile or search the full Pursuit inventory deliberately. Unrelated bids will not be substituted into your homepage.</p></div></div>
                )}
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
