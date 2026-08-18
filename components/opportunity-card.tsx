"use client";

import Link from "next/link";
import { ArrowUpRight, Clock3, DollarSign, MapPin } from "lucide-react";
import { Opportunity, OpportunityStage } from "@/lib/types";
import { useState } from "react";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const [decision, setDecision] = useState<OpportunityStage>(opportunity.stage);
  const lowConfidence = opportunity.confidence < 75;

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
        <div className="decision-row" aria-label="Opportunity decision">
          {(["pursuit", "watch", "walk"] as OpportunityStage[]).map(value => (
            <button key={value} onClick={() => setDecision(value)} className={decision === value ? "decision active" : "decision"}>
              {value === "pursuit" ? "Pursue" : value === "watch" ? "Watch" : "Walk"}
            </button>
          ))}
        </div>
      </div>
      <div className="opp-insight">
        <span>{lowConfidence ? "WHY CONFIDENCE IS LOW" : "WHAT WE VERIFIED"}</span>
        <p>{lowConfidence ? opportunity.uncertainty?.[0] : opportunity.verified[0]}</p>
        {opportunity.blocker && <small>{opportunity.blocker}</small>}
        {!opportunity.blocker && opportunity.uncertainty?.[0] && <small>{opportunity.uncertainty[0]}</small>}
      </div>
      <div className="opp-score">
        <span>Confidence</span>
        <strong>{opportunity.confidence}%</strong>
        <Link href={`/opportunities/${opportunity.id}`} aria-label="Open Five-Minute Brief"><ArrowUpRight size={18} /></Link>
      </div>
    </article>
  );
}
