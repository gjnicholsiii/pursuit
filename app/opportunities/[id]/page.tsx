import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, BadgeCheck, CircleAlert, Clock3, DollarSign, FileCheck2, FileSearch, Files, MapPin, Route, ShieldCheck } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { getStoredOpportunityById } from "@/lib/opportunity-store";
import { getOpportunityDocumentSummary } from "@/lib/document-store";

export const dynamic = "force-dynamic";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default async function OpportunityBriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [opportunity, documents] = await Promise.all([
    getStoredOpportunityById(id),
    getOpportunityDocumentSummary(id),
  ]);
  if (!opportunity) notFound();

  return (
    <main className="shell">
      <Sidebar active="Opportunities" />
      <section className="workspace">
        <header className="topbar brief-topbar">
          <Link href="/opportunities" className="brief-back"><ArrowLeft size={16} />Back to opportunities</Link>
          {opportunity.sourceUrl && <a className="secondary-button" href={opportunity.sourceUrl} target="_blank" rel="noreferrer">Original source <ArrowUpRight size={15} /></a>}
        </header>

        <div className="content brief-content">
          <section className="brief-hero">
            <div className="brief-title">
              <span className="eyebrow">FIVE-MINUTE BRIEF</span>
              <div className="opp-kicker brief-kicker"><span className="agency">{opportunity.agency}</span><span className={`eligibility-pill ${opportunity.eligibility}`}>{opportunity.eligibility.toUpperCase()}</span></div>
              <h1>{opportunity.title}</h1>
              <p>What Pursuit can verify now, what still needs package review, and what you should do next.</p>
            </div>
            <div className="confidence-panel">
              <span>INFORMATION CONFIDENCE</span>
              <strong>{opportunity.confidence}%</strong>
              <p>Confidence measures source completeness, not likelihood of winning.</p>
            </div>
          </section>

          <section className="brief-facts">
            <div><MapPin size={16} /><span>Location</span><strong>{opportunity.location}</strong></div>
            <div><Clock3 size={16} /><span>Response due</span><strong>{opportunity.due}</strong></div>
            <div><DollarSign size={16} /><span>Estimated value</span><strong>{opportunity.value == null ? "Not stated" : money(opportunity.value)}</strong></div>
            <div><FileSearch size={16} /><span>Solicitation</span><strong>{opportunity.solicitationNumber || "Not stated"}</strong></div>
          </section>

          <section className="brief-grid">
            <article className="brief-panel verified-panel">
              <div className="brief-panel-heading"><BadgeCheck size={18} /><div><span>VERIFIED</span><h2>What the source actually says</h2></div></div>
              <div className="brief-list">
                {opportunity.verified.length ? opportunity.verified.map(item => <div key={item}><ShieldCheck size={15} /><p>{item}</p></div>) : <p className="muted-copy">No critical facts have been verified yet.</p>}
              </div>
            </article>

            <article className="brief-panel uncertainty-panel">
              <div className="brief-panel-heading"><CircleAlert size={18} /><div><span>UNKNOWN / UNVERIFIED</span><h2>What still needs evidence</h2></div></div>
              <div className="brief-list">
                {(opportunity.uncertainty || []).map(item => <div key={item}><CircleAlert size={15} /><p>{item}</p></div>)}
              </div>
            </article>
          </section>

          <section className="brief-panel package-panel">
            <div className="brief-panel-heading"><Files size={18} /><div><span>BID PACKAGE</span><h2>Document acquisition status</h2></div></div>
            <div className="package-stats">
              <div><span>IDENTIFIED</span><strong>{documents.identified}</strong></div>
              <div><span>FETCHED</span><strong>{documents.fetched}</strong></div>
              <div><span>ANALYZED</span><strong>{documents.analyzed}</strong></div>
              <div><span>MISSING</span><strong>{documents.missing}</strong></div>
            </div>
            {documents.documents.length > 0 ? (
              <div className="package-list">
                {documents.documents.map(document => (
                  <a key={document.id} href={document.sourceUrl} target="_blank" rel="noreferrer">
                    <FileCheck2 size={15} />
                    <span>{document.filename}</span>
                    <small>{document.fetchedAt ? document.extractionStatus : "identified · awaiting fetch"}</small>
                    <ArrowUpRight size={14} />
                  </a>
                ))}
              </div>
            ) : (
              <p className="brief-explainer">No package links have been identified in the source record yet.</p>
            )}
          </section>

          <section className="brief-grid lower-grid">
            <article className="brief-panel">
              <div className="brief-panel-heading"><Route size={18} /><div><span>PATH TO AWARD</span><h2>{opportunity.procurementPath}</h2></div></div>
              <div className="brief-detail-list">
                <div><span>NAICS</span><strong>{opportunity.naicsCode || "Not stated"}</strong></div>
                <div><span>Set-aside</span><strong>{opportunity.setAside || "Not stated"}</strong></div>
                <div><span>Source</span><strong>{opportunity.source}</strong></div>
              </div>
              <p className="brief-explainer">Pursuit has identified the procurement mechanism from the public record. The complete submission path, mandatory forms, evaluation method, bonding, insurance and certifications remain provisional until the full package is acquired and analyzed.</p>
            </article>

            <article className="brief-panel next-action-panel">
              <div className="brief-panel-heading"><ArrowUpRight size={18} /><div><span>NEXT ACTION</span><h2>What to do now</h2></div></div>
              <p className="next-action-copy">{opportunity.nextStep}</p>
              <div className="brief-decisions">
                <button>Pursue</button>
                <button>Watch</button>
                <button>Walk</button>
              </div>
            </article>
          </section>

          <section className="evidence-strip">
            <div><span>WHY THIS MATTERS</span><strong>Pursuit separates evidence from inference.</strong></div>
            <p>When a requirement is missing, contradictory or still buried in an attachment, it remains visibly unresolved instead of being filled in from assumptions.</p>
            {opportunity.sourceUrl && <a href={opportunity.sourceUrl} target="_blank" rel="noreferrer">Open source evidence <ArrowUpRight size={15} /></a>}
          </section>
        </div>
      </section>
    </main>
  );
}
