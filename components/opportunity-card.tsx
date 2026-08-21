import Link from "next/link";
import { ArrowUpRight, Clock3, DollarSign, MapPin } from "lucide-react";
import type { Opportunity } from "@/lib/types";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const lowConfidence = opportunity.confidence < 75;
  const insight = opportunity.matchScore != null
    ? opportunity.matchReasons?.slice(0, 3).join(" · ") || "Profile criteria matched this opportunity."
    : lowConfidence
      ? opportunity.uncertainty?.[0]
      : opportunity.verified[0];

  return (
    <article className="opportunity-card">
      <div className="opp-main">
        <div className="opp-kicker">
          <span className="agency">{opportunity.agency}</span>
          <span className={`eligibility-pill ${opportunity.eligibility}`}>{opportunity.eligibility.toUpperCase()}</span>
        </div>
        <h3><Link href={`/opportunities/${opportunity.id}`}>{opportunity.title}</Link></h3>
        <div className="opp-meta">
          <span><MapPin size={14} />{opportunity.location}</span>
          <span><DollarSign size={14} />{opportunity.value == null ? "Value not stated" : money(opportunity.value)}</span>
          <span><Clock3 size={14} />Due {opportunity.due}</span>
        </div>
        <div className="tags"><span className="path-tag">{opportunity.procurementPath}</span>{opportunity.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
      </div>
      <div className="opp-insight">
        <span>{opportunity.matchScore != null ? "WHY THIS MATCHES YOU" : lowConfidence ? "WHY CONFIDENCE IS LOW" : "WHAT WE VERIFIED"}</span>
        <p>{insight || "Source record verified; document intelligence is still processing."}</p>
        {opportunity.blocker && <small>{opportunity.blocker}</small>}
      </div>
      <div className="opp-score">
        {opportunity.matchScore != null && <><span>Match</span><strong>{opportunity.matchScore}%</strong></>}
        <span>Confidence</span>
        <strong>{opportunity.confidence}%</strong>
        <Link href={`/opportunities/${opportunity.id}`} aria-label="Open Five-Minute Brief"><ArrowUpRight size={18} /></Link>
      </div>
    </article>
  );
}
