import { Sidebar } from "@/components/sidebar";
import { money } from "@/lib/low-voltage";
import { getPursuitsData, liveDatabaseConfigured } from "@/lib/lv-live-data";

export const dynamic = "force-dynamic";

export default async function PursuitsPage() {
  const pursuits = await getPursuitsData();
  const live = liveDatabaseConfigured();
  return (
    <main className="shell">
      <Sidebar active="Pursuits" />
      <section className="workspace">
        <header className="topbar"><div className="topbar-left"><i className="live-dot" /><span>PURSUITS · ACTIVE LOW-VOLTAGE OPPORTUNITIES</span></div><span className="chip">{live ? "LIVE LV FEED" : "PROTOTYPE DATA"}</span></header>
        <div className="content">
          <div className="page-head"><div><span className="eyebrow">PURSUITS</span><h1>CURRENT WORK WORTH CHASING.</h1><p>Only opportunities with credible low-voltage scope. Each pursuit exposes fit, due date, incumbent, specified technology, engineer and package depth.</p></div><input className="searchbar" placeholder="Search pursuit, owner, manufacturer…" /></div>
          <div className="stack">
            {pursuits.map(item => <article className="pursuit-card" key={item.id}>
              <div className="card-top"><span>{item.id} · {item.location}</span><strong>{item.fit}% FIT</strong></div>
              <h3>{item.organization} · {item.title}</h3>
              <div className="tag-row">{item.disciplines.map(d => <span className="tag" key={d}>{d}</span>)}</div>
              <div className="card-meta"><div className="meta-box"><span>EST. VALUE</span><strong>{money(item.estimatedValue)}</strong></div><div className="meta-box"><span>DUE</span><strong>{item.dueDate}</strong></div><div className="meta-box"><span>INCUMBENT</span><strong>{item.incumbent || "Unknown"}</strong></div><div className="meta-box"><span>ENGINEER</span><strong>{item.engineer || "Unknown"}</strong></div></div>
              <div className="card-meta"><div className="meta-box"><span>SPECIFIED</span><strong>{item.specified?.join(" · ") || "Not identified"}</strong></div><div className="meta-box"><span>PRE-BID</span><strong>{item.preBid || "Not stated"}</strong></div><div className="meta-box"><span>DOCUMENTS</span><strong>{item.documents}</strong></div><div className="meta-box"><span>ACTION</span><strong>Open pursuit</strong></div></div>
            </article>)}
          </div>
        </div>
      </section>
    </main>
  );
}
