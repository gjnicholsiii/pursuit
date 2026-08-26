import Link from "next/link";
import { after } from "next/server";
import { ArrowUpRight, Clock3, DollarSign, MapPin } from "lucide-react";
import { getSql } from "@/lib/db";
import type { Opportunity } from "@/lib/types";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const STALE_PACKAGE_MESSAGE = "No bid-package documents have been identified in Pursuit yet.";

type DiscoveryRow = { adapter_key: string };

async function prioritizeRatedLeadDocuments(opportunity: Opportunity) {
  if (opportunity.matchScore == null) return;

  const secret = process.env.CRON_SECRET;
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!secret || !productionHost) return;

  const sql = getSql();
  const rows = await sql.query(
    `update opportunities o
     set raw_payload = coalesce(o.raw_payload,'{}'::jsonb) || jsonb_build_object('pursuitPriorityDiscoveryRequestedAt', now())
     from sources s
     where o.id = $1
       and s.id = o.source_id
       and o.status = 'open'
       and (o.due_at is null or o.due_at >= now())
       and (s.adapter_key = 'sam_gov' or s.source_family = 'sled')
       and s.adapter_key <> 'nyscr_ny'
       and not exists (
         select 1 from opportunity_documents d
         where d.opportunity_id = o.id and coalesce(d.is_missing,false) = false
       )
       and (
         o.raw_payload->>'pursuitPriorityDiscoveryRequestedAt' is null
         or (o.raw_payload->>'pursuitPriorityDiscoveryRequestedAt')::timestamptz < now() - interval '15 minutes'
       )
     returning s.adapter_key`,
    [opportunity.id],
  ) as DiscoveryRow[];

  const row = rows[0];
  if (!row) return;

  const path = row.adapter_key === "sam_gov" ? "/api/documents/sam-discover" : "/api/documents/discover";
  const url = new URL(path, `https://${productionHost}`);
  url.searchParams.set("opportunityId", opportunity.id);

  after(async () => {
    try {
      await fetch(url, {
        cache: "no-store",
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(55_000),
      });
    } catch {
      // The 15-minute lease lets a later rated-feed render retry safely.
    }
  });
}

export async function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  await prioritizeRatedLeadDocuments(opportunity);

  const lowConfidence = opportunity.confidence < 75;
  const rawInsight = opportunity.matchScore != null
    ? opportunity.matchReasons?.slice(0, 3).join(" · ") || "Profile criteria matched this opportunity."
    : lowConfidence ? opportunity.uncertainty?.[0] : opportunity.verified[0];
  const insight = rawInsight === STALE_PACKAGE_MESSAGE
    ? "Pursuit has prioritized bid-package discovery for this rated lead. GO / NO-GO also forces an immediate package check."
    : rawInsight;

  return (
    <article className="opportunity-card">
      <div className="opp-main">
        <div className="opp-kicker"><span className="agency">{opportunity.agency}</span><span className={`eligibility-pill ${opportunity.eligibility}`}>{opportunity.eligibility.toUpperCase()}</span></div>
        <h3><Link href={`/opportunities/${opportunity.id}`}>{opportunity.title}</Link></h3>
        <div className="opp-meta"><span><MapPin size={14} />{opportunity.location}</span><span><DollarSign size={14} />{opportunity.value == null ? "Value not stated" : money(opportunity.value)}</span><span><Clock3 size={14} />Due {opportunity.due}</span></div>
        <div className="tags"><span className="path-tag">{opportunity.procurementPath}</span>{opportunity.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
      </div>
      <div className="opp-insight">
        <span>{opportunity.matchScore != null ? "WHY THIS MATCHES YOU" : lowConfidence ? "WHY CONFIDENCE IS LOW" : "WHAT WE VERIFIED"}</span>
        <p>{insight || "Source record verified; document intelligence is available on demand."}</p>
        {opportunity.blocker && opportunity.blocker !== STALE_PACKAGE_MESSAGE && <small>{opportunity.blocker}</small>}
      </div>
      <div className="opp-score">
        {opportunity.matchScore != null && <><span>Relevance</span><strong>{opportunity.matchScore}%</strong></>}
        {opportunity.matchScore != null ? <form action={`/api/opportunities/${opportunity.id}/go-no-go`} method="post"><button className="filter-button" type="submit">GO / NO-GO</button></form> : <><span>Confidence</span><strong>{opportunity.confidence}%</strong></>}
        <Link href={`/opportunities/${opportunity.id}`} aria-label="Open opportunity brief"><ArrowUpRight size={18} /></Link>
      </div>
    </article>
  );
}
