import { Sidebar } from "@/components/sidebar";
import { money, rebids } from "@/lib/low-voltage";

export default function RebidsPage() {
  return (
    <main className="shell">
      <Sidebar active="Rebids" />
      <section className="workspace">
        <header className="topbar"><div className="topbar-left"><i className="live-dot" /><span>REBIDS · CONTRACTS RETURNING TO MARKET</span></div><span className="chip">POSITION BEFORE PROCUREMENT</span></header>
        <div className="content">
          <div className="page-head"><div><span className="eyebrow">REBIDS</span><h1>WORK THE ACCOUNT BEFORE IT REOPENS.</h1><p>Existing low-voltage contracts ranked by current end date, renewal limits and evidence that a new procurement cycle is approaching.</p></div><input className="searchbar" placeholder="Search owner, incumbent, discipline…" /></div>
          <div className="stack">
            {rebids.map(item => <article className="rebid-card" key={item.id}>
              <div className="card-top"><span>{item.id} · {item.location}</span><strong>{item.probability}% REBID PROBABILITY</strong></div>
              <h3>{item.organization} · {item.title}</h3>
              <div className="tag-row">{item.disciplines.map(d => <span className="tag" key={d}>{d}</span>)}</div>
              <div className="card-meta"><div className="meta-box"><span>INCUMBENT</span><strong>{item.incumbent}</strong></div><div className="meta-box"><span>CONTRACT VALUE</span><strong>{money(item.contractValue)}</strong></div><div className="meta-box"><span>CURRENT END</span><strong>{item.currentEnd}</strong></div><div className="meta-box"><span>PROCUREMENT WINDOW</span><strong>{item.procurementWindow}</strong></div></div>
              <div className="progress"><i style={{width:`${item.probability}%`}} /></div>
            </article>)}
          </div>
          <div className="footer-note">A rebid score is a positioning signal, not a claim that a solicitation is guaranteed. Production scoring will expose the evidence that moved each contract up or down.</div>
        </div>
      </section>
    </main>
  );
}
