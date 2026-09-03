import Link from "next/link";
import { Activity, Crosshair, FileSearch, Radar, RefreshCcw, ShieldCheck } from "lucide-react";
import { incumbents, money, pursuits, rebids, signals, specs } from "@/lib/low-voltage";
import { Sidebar } from "@/components/sidebar";

const feed = [
  ["08:31", "School board approves $4.2M security modernization", "Access Control · Illinois", "94"],
  ["08:24", "Genetec appears in new courthouse security package", "SPEC · Missouri", "91"],
  ["08:17", "Access control contract enters final renewal year", "REBID · Illinois", "88"],
  ["08:03", "Hospital selects consultant for patient tower", "Nurse Call · Missouri", "91"],
  ["07:51", "Municipal camera modernization planning funded", "Video Surveillance · Arizona", "86"],
];

const radarDots = [
  ["29%", "31%", true], ["62%", "26%", false], ["74%", "43%", true], ["42%", "64%", false], ["57%", "72%", false],
  ["25%", "58%", true], ["68%", "62%", false], ["48%", "38%", true], ["35%", "75%", false], ["79%", "69%", false],
];

export function OverwatchDashboard() {
  const identifiedPipeline = signals.reduce((sum, item) => sum + item.estimatedValue, 0) + pursuits.reduce((sum, item) => sum + item.estimatedValue, 0);
  const rebidValue = rebids.reduce((sum, item) => sum + item.contractValue, 0);

  return (
    <main className="shell">
      <Sidebar active="Overwatch" />
      <section className="workspace">
        <header className="topbar">
          <div className="topbar-left"><i className="live-dot" /><span>OVERWATCH ACTIVE · LOW VOLTAGE ONLY</span></div>
          <div className="topbar-actions"><span className="chip">9 DISCIPLINES</span><span className="chip">NATIONAL</span></div>
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
            <div className="metric-card accent"><span>Identified LV pipeline</span><strong>{money(identifiedPipeline)}</strong><small>Signals + live pursuits currently on the glass</small></div>
            <div className="metric-card"><span>Pre-RFP signals</span><strong>{signals.length}</strong><small>Evidence of future low-voltage spending</small></div>
            <div className="metric-card"><span>Likely rebid value</span><strong>{money(rebidValue)}</strong><small>Existing contracts inside positioning horizon</small></div>
            <div className="metric-card"><span>Spec activity</span><strong>{specs.reduce((sum, item) => sum + item.activeProjects, 0)}</strong><small>Active project references across tracked manufacturers</small></div>
          </section>

          <section className="grid-main">
            <article className="panel">
              <div className="panel-head"><div><span>OPPORTUNITY RADAR</span><h2>Low-voltage activity forming across the market</h2></div><small>Closer to center = nearer buying activity</small></div>
              <div className="radar-stage">
                <div className="radar-ring r1" /><div className="radar-ring r2" /><div className="radar-ring r3" />
                <div className="radar-axis-x" /><div className="radar-axis-y" /><div className="radar-center" />
                <span className="radar-label" style={{left:"51%",top:"34%"}}>90D</span><span className="radar-label" style={{left:"51%",top:"21%"}}>6M</span><span className="radar-label" style={{left:"51%",top:"8%"}}>12M</span>
                {radarDots.map(([left, top, hot], index) => <i key={index} className={hot ? "radar-dot hot" : "radar-dot"} style={{left:String(left),top:String(top)}} />)}
              </div>
            </article>

            <article className="panel">
              <div className="panel-head"><div><span>OVERWATCH FEED</span><h2>What changed</h2></div><small>Latest detected intelligence</small></div>
              <div className="feed">{feed.map(([time,title,detail,score]) => <div className="feed-row" key={`${time}-${title}`}><span className="feed-time">{time}</span><div className="feed-copy"><strong>{title}</strong><span>{detail}</span></div><span className="score">{score}</span></div>)}</div>
            </article>
          </section>

          <section className="module-grid section-gap">
            <Link href="/signals" className="module-card"><span>SIGNALS</span><h3>Projects before the RFP.</h3><p>Capital plans, approvals, assessments, design activity and spending evidence.</p><strong>{signals.length} active</strong></Link>
            <Link href="/pursuits" className="module-card"><span>PURSUITS</span><h3>Current opportunities worth chasing.</h3><p>Low-voltage solicitations distilled into fit, scope, incumbent and spec intelligence.</p><strong>{pursuits.length} live</strong></Link>
            <Link href="/rebids" className="module-card"><span>REBIDS</span><h3>Contracts likely returning.</h3><p>Current end dates, renewal limits and evidence that procurement is approaching.</p><strong>{rebids.length} tracked</strong></Link>
            <Link href="/incumbents" className="module-card"><span>INCUMBENTS</span><h3>Who owns the work.</h3><p>Contractors, account exposure, technology footprints and competitive concentration.</p><strong>{incumbents.length} leaders</strong></Link>
            <Link href="/spec" className="module-card"><span>SPEC</span><h3>What is getting designed in.</h3><p>Manufacturers, products, pairings and early project references.</p><strong>{specs.length} tracked</strong></Link>
          </section>

          <section className="two-col section-gap">
            <article className="panel">
              <div className="panel-head"><div><span>TOP SIGNALS</span><h2>Best pre-RFP positioning windows</h2></div><Activity size={17} /></div>
              <div className="feed">{signals.slice(0,4).map(item => <div className="feed-row" key={item.id}><span className="feed-time">{item.id}</span><div className="feed-copy"><strong>{item.organization}</strong><span>{item.trigger} · {item.discipline} · {item.buyingWindow}</span></div><span className="score">{item.score}</span></div>)}</div>
            </article>
            <article className="panel">
              <div className="panel-head"><div><span>REBIDS APPROACHING</span><h2>Accounts worth working now</h2></div><RefreshCcw size={17} /></div>
              <div className="feed">{rebids.slice(0,4).map(item => <div className="feed-row" key={item.id}><span className="feed-time">{item.probability}%</span><div className="feed-copy"><strong>{item.organization}</strong><span>{item.incumbent} · {money(item.contractValue)} · {item.currentEnd}</span></div><span className="score">{item.procurementWindow.split(" ")[0]}</span></div>)}</div>
            </article>
          </section>

          <div className="footer-note">Prototype data is seeded to exercise the new LV product model. Production ingestion will populate these objects from verified public evidence and preserve the source behind every score.</div>
        </div>
      </section>
    </main>
  );
}
