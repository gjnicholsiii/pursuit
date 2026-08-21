import Link from "next/link";
import { Search } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { OpportunityCard } from "@/components/opportunity-card";
import { Sidebar } from "@/components/sidebar";
import { getCurrentCustomerProfile, getCustomerMatches } from "@/lib/customer-profile";
import type { CustomerProfile } from "@/lib/customer-profile";
import type { Opportunity } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  let dataError: string | undefined;
  let profile: CustomerProfile | null = null;
  let opportunities: Opportunity[] = [];

  try {
    profile = await getCurrentCustomerProfile();
    if (profile) opportunities = await getCustomerMatches(profile, { limit: 12, threshold: 45 });
  } catch (error) {
    dataError = error instanceof Error ? error.message : "Unable to build your opportunity feed";
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
          <Link href={profile ? "/opportunities?scope=matches" : "/profile"} className="searchbox">
            <Search size={17} />
            <span>{profile ? "Search your matches, or widen to all Pursuit..." : "Set up what your company sells..."}</span>
          </Link>
        </header>

        <div className="content">
          {!profile ? (
            <>
              <div className="hero-row">
                <div>
                  <span className="eyebrow">YOUR REVENUE FEED</span>
                  <h1>WIN MORE / WORK LESS</h1>
                  <p>Tell Pursuit what your company sells. Your homepage will then show the government opportunities that fit your codes, capabilities, territories and target contract range.</p>
                </div>
                <Link href="/profile" className="secondary-button">Build my selling profile</Link>
              </div>
              <section className="readiness-panel">
                <div className="readiness-copy">
                  <span className="eyebrow">NO GENERIC BID DUMP</span>
                  <h2>Your homepage starts with your company.</h2>
                  <p>Pursuit will not fill this feed with unrelated professions. Set your NAICS and PSC codes, capabilities, territories, certifications and target values first.</p>
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
