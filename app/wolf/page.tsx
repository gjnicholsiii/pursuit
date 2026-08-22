import Link from "next/link";
import { Sidebar } from "@/components/sidebar";

export default function WolfPage() {
  return (
    <main className="shell">
      <Sidebar active="Wolf" />
      <section className="workspace">
        <header className="topbar"><div className="searchbox"><span>Wolf turns Raven intelligence into prioritized pursuit.</span></div></header>
        <div className="content">
          <div className="hero-row"><div><span className="eyebrow">WOLF / PURSUIT ENGINE</span><h1>KNOW WHAT TO DO NEXT.</h1><p>Wolf takes Raven&apos;s intelligence and turns it into action: who to contact, what opportunity to chase, what angle to use, who influences the deal and where the best chance to win exists.</p></div><Link href="/raven" className="secondary-button">Open Raven</Link></div>
          <section className="readiness-panel">
            <div className="readiness-copy"><span className="eyebrow">FROM SIGNAL TO ACTION</span><h2>Prioritize the pursuit, not the noise.</h2><p>Wolf will rank targets using fit, timing, relationships, prior activity and evidence, then surface the next best commercial action.</p></div>
            <div className="readiness-grid">
              <div className="readiness-item"><div><strong>TARGET</strong><small>The organization and buyer worth pursuing now</small></div></div>
              <div className="readiness-item"><div><strong>WHY NOW</strong><small>The signal, project, award, change or relationship creating the opening</small></div></div>
              <div className="readiness-item"><div><strong>ANGLE</strong><small>The most credible reason to start the conversation</small></div></div>
              <div className="readiness-item"><div><strong>NEXT ACTION</strong><small>Research, contact, partner, qualify, bid, watch or pass</small></div></div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}