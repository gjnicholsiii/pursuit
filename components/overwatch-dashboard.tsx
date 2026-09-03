import Link from "next/link";
import { Activity, RefreshCcw } from "lucide-react";
import { money } from "@/lib/low-voltage";
import { getAllLVData } from "@/lib/lv-live-data";
import { Sidebar } from "@/components/sidebar";

export async function OverwatchDashboard() {
  const { signals, pursuits, rebids, incumbents, specs, live } = await getAllLVData();
  const identifiedPipeline = signals.reduce((sum, item) => sum + item.estimatedValue, 0) + pursuits.reduce((sum, item) => sum + item.estimatedValue, 0);
  const likelyRebids = rebids.filter(item => item.probability >= 55);
  const rebidValue = likelyRebids.reduce((sum, item) => sum + item.contractValue, 0);
  const feed = [
    ...signals.slice(0, 3).map(item => ({ kind: "SIGNAL", title: `${item.organization} · ${item.trigger}`, detail: `${item.discipline} · ${item.location}`, score: item.score })),
    ...likelyRebids.slice(0, 2).map(item => ({ kind: "REBID", title: `${item.organization} · ${item.title}`, detail: `${item.incumbent} · ${item.procurementWindow}`, score: item.probability })),
  ].slice(0, 5);
  const radarItems = [
    ...signals.map(item => ({ id: item.id, score: item.score, hot: item.score >= 80 })),
    ...likelyRebids.map(item => ({ id: item.id, score: item.probability, hot: item.probability >= 80 })),
  ].slice(0, 24);
  const radarDots = radarItems.map((item, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, radarItems.length) - Math.PI / 2;
    const radius = 8 + ((100 - Math.max(0, Math.min(100, item.score))) / 100) * 34;
    return {
      ...item,
      left: `${50 + Math.cos(angle) * radius}%`,
      top: `${50 + Math.sin(angle) * radius}%`,
    };
  });

  return (
    <main className="shell">
      <Sidebar active="Overwatch" />
      <section className="workspace">
        <header className="topbar">
          <div className="topbar-left"><i className="live-dot" /><span>OVERWATCH ACTIVE · LOW VOLTAGE ONLY</span></div>
          <div className="topbar-actions"><span className="chip">{live ? "LIVE LV DATABASE" : "PROTOTYPE DATA"}</span><span className="chip">9 DISCIPLINES</span><span className="chip">NATIONAL</span></div>
        </header>
        <div className="content">
          <section className="hero">
            <div>
              <span className="eyebrow">PURSUIT / OVERWATCH</span>
              <h1>SEE THE WORK FORMING.</h1>
              <p>Low-voltage intelligence built around what matters to contractors: projects before the RFP, live work worth chasing, contracts returning to market, who owns the account, and what is being specified.</p>
            </div>
            <div className="hero-flow">DISCOVER → PREDICT → IDENTIFY → PURSUE</div>
          </section>

          <section className="metrics">
            <div className="metric-card accent"><span>Identified LV pipeline</span><strong>{money(identifiedPipeline)}</strong><small>Verified Signals + live Pursuits</small></div>
            <div className="metric-card"><span>Pre-RFP signals</span><strong>{signals.length}</strong><small>Evidence of future low-voltage spending</small></div>
            <div className="metric-card"><span>Likely rebid value</span><strong>{money(rebidValue)}</strong><small>Contracts currently scoring 55% or higher</small></div>
            <div className="metric-card"><span>Spec activity</span><strong>{specs.reduce((sum, item) => sum + item.activeProjects, 0)}</strong><small>Verified project references across tracked manufacturers</small></div>
          </section>

          <section className="grid-main">
            <article className="panel">
              <div className="panel-head"><div><span>OPPORTUNITY RADAR</span><h2>Current scored low-voltage activity</h2></div><small>Higher score = closer to center</small></div>
              <div className="radar-stage">
                <div className="radar-ring r1" /><div className="radar-ring r2" /><div className="radar-ring r3" />
                <div className="radar-axis-x" /><div className="radar-axis-y" /><div className="radar-center" />
                <span className="radar-label" style={{left:"51%",top:"34%"}}>80+</span><span className="radar-label" style={{left:"51%",top:"21%"}}>65+</span><span className="radar-label" style={{left:"51%",top:"8%"}}>55+</span>
                {radarDots.map(item => <i key={item.id} className={item.hot ? "radar-dot hot" : "radar-dot"} style={{left:item.left,top:item.top}} />)}
                {!radarDots.length && <div className="footer-note">No qualifying live Signals or Rebids yet.</div>}
              </div>
            </article>

            <article className="panel">
              <div className="panel-head"><div><span>OVERWATCH FEED</span><h2>What deserves attention</h2></div><small>{live ? "Current database" : "Prototype dataset"}</small></div>
              <div className="feed">
                {feed.map(item => <div className="feed-row" key={`${item.kind}-${item.title}`}><span className="feed-time">{item.kind}</span><div className="feed-copy"><strong>{item.title}</strong><span>{item.detail}</span></div><span className="score">{item.score}</span></div>)}
                {!feed.length && <div className="footer-note">No qualifying live activity yet.</div>}
              </div>
            </article>
          </section>

          <section className="module-grid section-gap">
            <Link href="/signals" className="module-card"><span>SIGNALS</span><h3>Projects before the RFP.</h3><p>Capital plans, approvals, assessments, design activity and spending evidence.</p><strong>{signals.length} active</strong></Link>
            <Link href="/pursuits" className="module-card"><span>PURSUITS</span><h3>Current opportunities worth chasing.</h3><p>Low-voltage solicitations distilled into fit, scope, incumbent and spec intelligence.</p><strong>{pursuits.length} live</strong></Link>
            <Link href="/rebids" className="module-card"><span>REBIDS</span><h3>Contracts likely returning.</h3><p>Current end dates, renewal limits and evidence that procurement is approaching.</p><strong>{likelyRebids.length} likely</strong></Link>
            <Link href="/incumbents" className="module-card"><span>INCUMBENTS</span><h3>Who owns the work.</h3><p>Contractors, account exposure, technology footprints and competitive concentration.</p><strong>{incumbents.length} identified</strong></Link>
            <Link href="/spec" className="module-card"><span>SPEC</span><h3>What is getting designed in.</h3><p>Manufacturers, products, pairings and early project references.</p><strong>{specs.length} tracked</strong></Link>
          </section>

          <section className="two-col section-gap">
            <article className="panel">
              <div className="panel-head"><div><span>TOP SIGNALS</span><h2>Best pre-RFP positioning windows</h2></div><Activity size={17} /></div>
              <div className="feed">
                {signals.slice(0,4).map(item => <div className="feed-row" key={item.id}><span className="feed-time">{item.id}</span><div className="feed-copy"><strong>{item.organization}</strong><span>{item.trigger} · {item.discipline} · {item.buyingWindow}</span></div><span className="score">{item.score}</span></div>)}
                {!signals.length && <div className="footer-note">No verified pre-RFP Signals yet.</div>}
              </div>
            </article>
            <article className="panel">
              <div className="panel-head"><div><span>REBIDS APPROACHING</span><h2>Accounts worth working now</h2></div><RefreshCcw size={17} /></div>
              <div className="feed">
                {likelyRebids.slice(0,4).map(item => <div className="feed-row" key={item.id}><span className="feed-time">{item.probability}%</span><div className="feed-copy"><strong>{item.organization}</strong><span>{item.incumbent} · {money(item.contractValue)} · {item.currentEnd}</span></div><span className="score">{item.procurementWindow.split(" ")[0]}</span></div>)}
                {!likelyRebids.length && <div className="footer-note">No contracts have crossed the 55% rebid threshold yet.</div>}
              </div>
            </article>
          </section>

          <div className="footer-note">{live ? "Showing only records from the isolated Pursuit low-voltage database. Every stored intelligence item retains its public source evidence." : "Prototype data is shown only when the isolated low-voltage database is not connected."}</div>
        </div>
      </section>
    </main>
  );
}
