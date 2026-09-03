import { Sidebar } from "@/components/sidebar";
import { money } from "@/lib/low-voltage";
import { getIncumbentsData, liveDatabaseConfigured } from "@/lib/lv-live-data";

export default async function IncumbentsPage() {
  const incumbents = await getIncumbentsData();
  const live = liveDatabaseConfigured();
  const max = Math.max(1, ...incumbents.map(item => item.identifiedValue));
  return (
    <main className="shell">
      <Sidebar active="Incumbents" />
      <section className="workspace">
        <header className="topbar"><div className="topbar-left"><i className="live-dot" /><span>INCUMBENTS · WHO OWNS THE WORK NOW</span></div><span className="chip">{live ? "LIVE CONTRACT INTEL" : "PROTOTYPE DATA"}</span></header>
        <div className="content">
          <div className="page-head"><div><span className="eyebrow">INCUMBENTS</span><h1>KNOW WHO IS ALREADY INSIDE.</h1><p>Search the contractor first, then see the accounts, contract value, technologies and markets tied to that incumbent.</p></div><input className="searchbar" placeholder="Search contractor, technology, market…" /></div>
          <section className="two-col">
            <article className="panel"><div className="panel-head"><div><span>INCUMBENT EXPOSURE</span><h2>Identified low-voltage contract value</h2></div><small>{live ? "Verified contracts" : "Prototype dataset"}</small></div><div className="bar-list">{incumbents.map(item => <div className="bar-item" key={item.contractor}><div className="bar-title"><strong>{item.contractor}</strong><span>{money(item.identifiedValue)} · {item.contracts} contracts</span></div><div className="bar-track"><i style={{width:`${(item.identifiedValue/max)*100}%`}} /></div></div>)}</div></article>
            <article className="panel"><div className="panel-head"><div><span>TECHNOLOGY FOOTPRINT</span><h2>What incumbents are installing</h2></div><small>Evidence only</small></div><div className="feed">{incumbents.map(item => <div className="feed-row" key={item.contractor}><span className="feed-time">{item.contracts}</span><div className="feed-copy"><strong>{item.contractor}</strong><span>{item.technologies.length ? item.technologies.join(" · ") : "No product evidence linked yet"}</span></div><span className="score">{item.markets.length}</span></div>)}</div></article>
          </section>
          <div className="table-wrap section-gap"><table className="data-table"><thead><tr><th>INCUMBENT</th><th>IDENTIFIED VALUE</th><th>CONTRACTS</th><th>MARKETS</th><th>TECHNOLOGIES</th><th>ACTION</th></tr></thead><tbody>{incumbents.map(item => <tr key={item.contractor}><td><strong>{item.contractor}</strong></td><td>{money(item.identifiedValue)}</td><td>{item.contracts}</td><td>{item.markets.join(" · ") || "Unknown"}</td><td>{item.technologies.join(" · ") || "Not yet observed"}</td><td><strong>Open exposure</strong></td></tr>)}</tbody></table></div>
        </div>
      </section>
    </main>
  );
}
