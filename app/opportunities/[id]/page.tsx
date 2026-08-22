import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, BadgeCheck, CircleAlert, Clock3, DollarSign, FileCheck2, FileSearch, Files, MapPin, Route, ShieldCheck } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { GoNoGoPanel } from "@/components/go-no-go-panel";
import { getStoredOpportunityById } from "@/lib/opportunity-store";
import { getOpportunityDocumentSummary } from "@/lib/document-store";

export const dynamic = "force-dynamic";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const categoryLabel = (category: string) => category.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());

export default async function OpportunityBriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [opportunity, documents] = await Promise.all([getStoredOpportunityById(id), getOpportunityDocumentSummary(id)]);
  if (!opportunity) notFound();

  const uncertainty = (opportunity.uncertainty || []).filter(item => !/package document|package review|solicitation package/i.test(item));
  if (documents.identified === 0) uncertainty.push("No bid-package documents have been identified in the source record yet.");
  else {
    if (documents.missing > 0) uncertainty.push(`${documents.missing} identified package document${documents.missing === 1 ? " is" : "s are"} currently unavailable from the source.`);
    if (documents.identified > documents.fetched) uncertainty.push(`${documents.identified - documents.fetched} additional package document${documents.identified - documents.fetched === 1 ? " is" : "s are"} cataloged and will be retrieved only when requested.`);
  }

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
              <span className="eyebrow">PURSUIT BRIEF</span>
              <div className="opp-kicker brief-kicker"><span className="agency">{opportunity.agency}</span><span className={`eligibility-pill ${opportunity.eligibility}`}>{opportunity.eligibility.toUpperCase()}</span></div>
              <h1>{opportunity.title}</h1>
              <p>See why this opportunity matched your company, then run a deep GO / NO-GO check only when it deserves your time.</p>
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

          <GoNoGoPanel opportunityId={id} />

          <section className="brief-grid">
            <article className="brief-panel verified-panel">
              <div className="brief-panel-heading"><BadgeCheck size={18} /><div><span>VERIFIED</span><h2>What the source already says</h2></div></div>
              <div className="brief-list">
                {opportunity.verified.length ? opportunity.verified.map(item => <div key={item}><ShieldCheck size={15} /><p>{item}</p></div>) : <p className="muted-copy">No critical facts have been verified yet.</p>}
              </div>
            </article>

            <article className="brief-panel uncertainty-panel">
              <div className="brief-panel-heading"><CircleAlert size={18} /><div><span>UNKNOWN / UNVERIFIED</span><h2>What still needs evidence</h2></div></div>
              <div className="brief-list">
                {uncertainty.map(item => <div key={item}><CircleAlert size={15} /><p>{item}</p></div>)}
              </div>
            </article>
          </section>

          {documents.requirements.length > 0 && (
            <section className="brief-panel requirement-panel">
              <div className="brief-panel-heading"><ShieldCheck size={18} /><div><span>QUALIFICATION EVIDENCE</span><h2>Mandatory items found during deep analysis</h2></div></div>
              <div className="requirement-list">
                {documents.requirements.map(requirement => (
                  <article className="requirement-item" key={requirement.id}>
                    <div className="requirement-meta"><span>{categoryLabel(requirement.category)}</span><small>{requirement.line ? `Source line ${requirement.line}` : "Source located"}</small></div>
                    <p>{requirement.requirementText}</p>
                    <div className="requirement-source"><div><strong>{requirement.filename}</strong><span>{requirement.confidence == null ? "Evidence-backed" : `${Math.round(requirement.confidence * 100)}% extraction confidence`}</span></div><a href={requirement.sourceUrl} target="_blank" rel="noreferrer">Open source document <ArrowUpRight size={14} /></a></div>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="brief-panel package-panel">
            <div className="brief-panel-heading"><Files size={18} /><div><span>BID PACKAGE</span><h2>Cataloged documents</h2></div></div>
            <div className="package-stats">
              <div><span>IDENTIFIED</span><strong>{documents.identified}</strong></div>
              <div><span>RETRIEVED</span><strong>{documents.fetched}</strong></div>
              <div><span>ANALYZED</span><strong>{documents.analyzed}</strong></div>
              <div><span>UNAVAILABLE</span><strong>{documents.missing}</strong></div>
            </div>
            {documents.documents.length > 0 ? <div className="package-list">{documents.documents.map(document => (
              <a key={document.id} href={document.sourceUrl} target="_blank" rel="noreferrer"><FileCheck2 size={15} /><span>{document.filename}</span><small>{document.fetchedAt ? document.extractionStatus : "cataloged · retrieve on request"}</small><ArrowUpRight size={14} /></a>
            ))}</div> : <p className="brief-explainer">No package links have been identified in the source record yet.</p>}
            {documents.identified > documents.fetched && <form action={`/api/opportunities/${id}/package`} method="post" className="profile-actions"><button className="secondary-button" type="submit">Get complete bid package</button></form>}
          </section>

          <section className="brief-grid lower-grid">
            <article className="brief-panel">
              <div className="brief-panel-heading"><Route size={18} /><div><span>PATH TO AWARD</span><h2>{opportunity.procurementPath}</h2></div></div>
              <div className="brief-detail-list"><div><span>NAICS</span><strong>{opportunity.naicsCode || "Not stated"}</strong></div><div><span>Set-aside</span><strong>{opportunity.setAside || "Not stated"}</strong></div><div><span>Source</span><strong>{opportunity.source}</strong></div></div>
              <p className="brief-explainer">Pursuit catalogs the source package continuously. Qualification-bearing documents are read on demand; supporting files are retrieved only when you request the complete package.</p>
            </article>

            <article className="brief-panel next-action-panel">
              <div className="brief-panel-heading"><ArrowUpRight size={18} /><div><span>NEXT ACTION</span><h2>Decide whether this deserves pursuit time</h2></div></div>
              <p className="next-action-copy">Run GO / NO-GO to compare the actual solicitation requirements against your saved company qualifications. Retrieve the full package only if you decide to proceed.</p>
              <form action={`/api/opportunities/${id}/go-no-go`} method="post"><button className="filter-button" type="submit">GO / NO-GO</button></form>
            </article>
          </section>

          <section className="evidence-strip">
            <div><span>WHY THIS MATTERS</span><strong>Pursuit separates evidence from inference.</strong></div>
            <p>A strong match never becomes an invented qualification. Potential disqualifiers and unknowns stay visible with their source evidence.</p>
            {opportunity.sourceUrl && <a href={opportunity.sourceUrl} target="_blank" rel="noreferrer">Open source evidence <ArrowUpRight size={15} /></a>}
          </section>
        </div>
      </section>
    </main>
  );
}
