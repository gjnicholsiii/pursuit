import { Sidebar } from "@/components/sidebar";
import { money } from "@/lib/low-voltage";
import { getSignalsData, liveDatabaseConfigured } from "@/lib/lv-live-data";

export const dynamic = "force-dynamic";

export default async function SignalsPage() {
  const signals = await getSignalsData();
  const live = liveDatabaseConfigured();
  return (
    <main className="shell">
      <Sidebar active="Signals" />
      <section className="workspace">
        <header className="topbar"><div className="topbar-left"><i className="live-dot" /><span>SIGNALS · PRE-RFP INTELLIGENCE</span></div><span className="chip">{live ? "LIVE EVIDENCE" : "PROTOTYPE DATA"}</span></header>
        <div className="content">
          <div className="page-head"><div><span className="eyebrow">SIGNALS</span><h1>PROJECTS BEFORE THE RFP.</h1><p>Evidence that low-voltage spending is forming: capital plans, board approvals, facility assessments, consultant selections, design activity and budget allocations.</p></div><input className="searchbar" placeholder="Search organization, state, discipline…" /></div>
          <div className="stack">
            {signals.map(item => <article className="signal-card" key={item.id}>
              <div className="card-top"><span>{item.id} · {item.discipline}</span><strong className={item.confidence === "HIGH" ? "confidence-high" : "confidence-medium"}>{item.confidence} CONFIDENCE · {item.score}</strong></div>
              <h3>{item.organization} · {item.trigger}</h3><p>{item.evidence}</p>
              <div className="card-meta"><div className="meta-box"><span>LOCATION</span><strong>{item.location}</strong></div><div className="meta-box"><span>EST. OPPORTUNITY</span><strong>{money(item.estimatedValue)}</strong></div><div className="meta-box"><span>BUYING WINDOW</span><strong>{item.buyingWindow}</strong></div><div className="meta-box"><span>NEXT ACTION</span><strong>Work the account</strong></div></div>
            </article>)}
          </div>
          <div className="footer-note">A Signal cannot exist in the live database without public source evidence. Confidence is based on evidence type, source quality, recency and low-voltage specificity.</div>
        </div>
      </section>
    </main>
  );
}
