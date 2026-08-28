import Link from "next/link";
import { ArrowUpRight, Clock3, Crosshair, Radar, ShieldCheck } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { getCurrentCustomerProfile } from "@/lib/customer-profile";
import { getOverwatchFeed, type OverwatchAward } from "@/lib/overwatch";
import styles from "./overwatch.module.css";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const HORIZON_DAYS = 730;

function money(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

function date(value: string | null) {
  if (!value) return "Date unavailable";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
}

function compact(value: string, length = 42) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean;
}

function groupAwards(awards: OverwatchAward[], key: (award: OverwatchAward) => string) {
  const grouped = new Map<string, { name: string; count: number; amount: number }>();
  for (const award of awards) {
    const name = key(award) || "Unknown";
    const current = grouped.get(name) || { name, count: 0, amount: 0 };
    current.count += 1;
    current.amount += award.amount;
    grouped.set(name, current);
  }
  return [...grouped.values()].sort((a, b) => b.amount - a.amount || b.count - a.count);
}

function bandCount(awards: OverwatchAward[], from: number, to: number) {
  return awards.filter(award => award.daysToEnd >= from && award.daysToEnd < to).length;
}

function awardUrl(award: OverwatchAward) {
  return award.generatedId ? `https://www.usaspending.gov/award/${encodeURIComponent(award.generatedId)}/` : "https://www.usaspending.gov/";
}

export default async function OverwatchPage() {
  const profile = await getCurrentCustomerProfile();
  const feed = await getOverwatchFeed(profile);
  const awards = feed.awards;
  const now = Date.now();

  const ending180 = awards.filter(award => award.daysToEnd >= 0 && award.daysToEnd <= 180);
  const ending365 = awards.filter(award => award.daysToEnd >= 0 && award.daysToEnd <= 365);
  const observedValue = awards.reduce((sum, award) => sum + award.amount, 0);
  const incumbents = groupAwards(awards, award => award.recipient).slice(0, 5);
  const agencies = groupAwards(awards, award => award.agency).slice(0, 6);
  const maxAgencyAmount = Math.max(1, ...agencies.map(item => item.amount));
  const horizon = [
    { label: "0–90D", count: bandCount(awards, 0, 90) },
    { label: "3–6M", count: bandCount(awards, 90, 180) },
    { label: "6–12M", count: bandCount(awards, 180, 365) },
    { label: "12–18M", count: bandCount(awards, 365, 548) },
    { label: "18–24M", count: bandCount(awards, 548, 731) },
  ];
  const maxBand = Math.max(1, ...horizon.map(item => item.count));
  const radarAwards = awards.filter(award => award.daysToEnd >= 0).slice(0, 28);
  const focusAwards = awards.filter(award => award.daysToEnd >= 0).slice(0, 8);
  const incumbentTotal = Math.max(1, incumbents.reduce((sum, item) => sum + item.amount, 0));
  let ringOffset = 0;

  return (
    <main className="shell">
      <Sidebar active="Overwatch" />
      <section className="workspace">
        <header className="topbar">
          <div className="searchbox"><Radar size={17} /><span>Federal contract horizon · USAspending award history</span></div>
          <div className="top-actions"><Link href="/profile" className="secondary-button">Tune company profile</Link></div>
        </header>

        <div className="content">
          <div className="hero-row">
            <div>
              <span className="eyebrow">OVERWATCH / FORWARD REVENUE INTELLIGENCE</span>
              <h1>SEE THE WORK BEFORE IT RETURNS.</h1>
              <p>Track contracts approaching the end of performance, see who owns the work now, and identify where future pursuit activity is concentrating.</p>
            </div>
          </div>

          <section className="metrics">
            <div className="metric-card accent"><span>Contracts on horizon</span><strong>{awards.length.toLocaleString()}</strong><small>Recently active awards matching this profile</small></div>
            <div className="metric-card"><span>Ending within 6 months</span><strong>{ending180.length.toLocaleString()}</strong><small>Highest near-term recompete pressure</small></div>
            <div className="metric-card"><span>Ending within 12 months</span><strong>{ending365.length.toLocaleString()}</strong><small>Positioning window</small></div>
            <div className="metric-card"><span>Observed award value</span><strong>{money(observedValue)}</strong><small>Current award values in this horizon</small></div>
          </section>

          <div className={styles.contextStrip}>
            <div><ShieldCheck size={15} /><span>PROFILE</span><strong>{profile?.organizationName || "Broad federal view"}</strong></div>
            <div><Crosshair size={15} /><span>MATCH</span><strong>{feed.filters.join(" · ")}</strong></div>
            <div><Clock3 size={15} /><span>UPDATED</span><strong>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(feed.generatedAt))}</strong></div>
          </div>

          <section className={styles.visualGrid}>
            <article className={styles.radarPanel}>
              <div className={styles.panelHeading}><div><span>RECOMPETE RADAR</span><h2>Contracts moving toward the line</h2></div><small>Distance = days to current end date · bubble = award value</small></div>
              <div className={styles.radarStage} aria-label="Visual radar of federal contract end dates">
                <div className={`${styles.ring} ${styles.ringOne}`}><span>6M</span></div>
                <div className={`${styles.ring} ${styles.ringTwo}`}><span>12M</span></div>
                <div className={`${styles.ring} ${styles.ringThree}`}><span>24M</span></div>
                <div className={styles.radarAxis} />
                <div className={styles.radarSweep} />
                <div className={styles.centerMark}><Crosshair size={18} /></div>
                {radarAwards.map((award, index) => {
                  const distance = Math.max(0, Math.min(HORIZON_DAYS, award.daysToEnd));
                  const radius = 13 + (distance / HORIZON_DAYS) * 41;
                  const angle = ((index * 137.5 + award.signalScore * 1.8) % 360) * (Math.PI / 180);
                  const left = 50 + Math.cos(angle) * radius;
                  const top = 50 + Math.sin(angle) * radius;
                  const size = Math.max(7, Math.min(18, 7 + Math.log10(Math.max(1, award.amount)) * 1.15));
                  return <a key={`${award.awardId}-${index}`} className={styles.radarDot} href={awardUrl(award)} target="_blank" rel="noreferrer" style={{ left: `${left}%`, top: `${top}%`, width: size, height: size }} title={`${award.agency} · ${award.recipient} · ${date(award.endDate)} · ${money(award.amount)}`}><span /></a>;
                })}
                {!radarAwards.length && <div className={styles.noSignal}>No matching end-date signals returned.</div>}
              </div>
              <div className={styles.radarLegend}><span><i className={styles.hotDot} />near-term</span><span><i className={styles.coolDot} />longer horizon</span><strong>{radarAwards.length} signals plotted</strong></div>
            </article>

            <article className={styles.horizonPanel}>
              <div className={styles.panelHeading}><div><span>HORIZON</span><h2>When the pressure builds</h2></div><small>Current end dates</small></div>
              <div className={styles.horizonChart}>
                {horizon.map(item => <div key={item.label} className={styles.horizonColumn}><div className={styles.barTrack}><div className={styles.barFill} style={{ height: `${Math.max(item.count ? 12 : 2, (item.count / maxBand) * 100)}%` }}><b>{item.count}</b></div></div><span>{item.label}</span></div>)}
              </div>
              <p className={styles.caption}>A contract reaching its current end date is a signal, not proof of a recompete. Overwatch ranks the positioning window; the solicitation becomes Pursuit&apos;s job when it appears.</p>
            </article>
          </section>

          <section className={styles.visualGridSecondary}>
            <article className={styles.incumbentPanel}>
              <div className={styles.panelHeading}><div><span>INCUMBENT CONCENTRATION</span><h2>Who owns the work now</h2></div><small>Share of observed award value</small></div>
              <div className={styles.incumbentBody}>
                <svg className={styles.donut} viewBox="0 0 180 180" role="img" aria-label="Incumbent concentration chart">
                  <circle cx="90" cy="90" r="63" className={styles.donutBase} />
                  {incumbents.map((item, index) => {
                    const circumference = 395.84;
                    const segment = Math.max(2, (item.amount / incumbentTotal) * circumference);
                    const dash = `${segment} ${circumference - segment}`;
                    const offset = -ringOffset;
                    ringOffset += segment;
                    return <circle key={item.name} cx="90" cy="90" r="63" className={`${styles.donutSegment} ${styles[`segment${index + 1}`] || styles.segment5}`} strokeDasharray={dash} strokeDashoffset={offset} />;
                  })}
                  <text x="90" y="85" textAnchor="middle" className={styles.donutValue}>{incumbents.length}</text>
                  <text x="90" y="105" textAnchor="middle" className={styles.donutLabel}>TOP INCUMBENTS</text>
                </svg>
                <div className={styles.incumbentKeys}>{incumbents.map((item, index) => <div key={item.name}><i className={`${styles.keyDot} ${styles[`key${index + 1}`] || styles.key5}`} /><span>{compact(item.name, 30)}</span><strong>{money(item.amount)}</strong></div>)}</div>
              </div>
            </article>

            <article className={styles.agencyPanel}>
              <div className={styles.panelHeading}><div><span>AGENCY EXPOSURE</span><h2>Where the dollars are concentrated</h2></div><small>Observed award value</small></div>
              <div className={styles.agencyBars}>{agencies.map(item => <div key={item.name} className={styles.agencyBar}><div><span>{compact(item.name, 34)}</span><strong>{money(item.amount)}</strong></div><div className={styles.agencyTrack}><i style={{ width: `${Math.max(3, (item.amount / maxAgencyAmount) * 100)}%` }} /></div></div>)}</div>
            </article>
          </section>

          <section className={styles.focusSection}>
            <div className={styles.panelHeading}><div><span>NEXT ON THE GLASS</span><h2>Contracts worth positioning around now</h2></div><small>Sorted by current end date</small></div>
            <div className={styles.focusGrid}>
              {focusAwards.map(award => <a key={award.awardId} className={styles.focusCard} href={awardUrl(award)} target="_blank" rel="noreferrer">
                <div className={styles.focusTop}><span>{award.daysToEnd <= 180 ? "NEAR TERM" : award.daysToEnd <= 365 ? "POSITION" : "WATCH"}</span><strong>{award.signalScore}</strong></div>
                <h3>{compact(award.description, 78)}</h3>
                <p>{award.agency}</p>
                <div className={styles.incumbentLine}><span>INCUMBENT</span><strong>{compact(award.recipient, 38)}</strong></div>
                <div className={styles.focusMeta}><span>{money(award.amount)}</span><span>{date(award.endDate)}</span><ArrowUpRight size={14} /></div>
              </a>)}
              {!focusAwards.length && <div className={styles.emptyCard}><strong>No matching federal contract signals yet.</strong><span>Update the selling profile with NAICS or PSC codes to narrow the Overwatch feed.</span></div>}
            </div>
          </section>

          {feed.warnings.length > 0 && <div className={styles.warning}>USAspending returned a partial feed: {feed.warnings.join(" · ")}. Overwatch is still showing every verified award record received.</div>}
          <div className={styles.methodNote}>Overwatch currently treats recently active federal contract awards with future performance end dates as forward signals. Signal scores combine recency, time-to-end, award value and classification data. They are positioning indicators, not confirmed procurement notices.</div>
        </div>
      </section>
    </main>
  );
}
