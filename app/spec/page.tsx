import { Sidebar } from "@/components/sidebar";
import { money } from "@/lib/low-voltage";
import { getSpecsData } from "@/lib/lv-live-data";

export const dynamic = "force-dynamic";

export default async function SpecPage() {
  const specs = await getSpecsData();
  const max = Math.max(1, ...specs.map(item => item.activeProjects));
  return (
    <main className="shell">
      <Sidebar active="Spec" />
      <section className="workspace">
        <header className="topbar"><div className="topbar-left"><i className="live-dot" /><span>SPEC · PRODUCTS APPEARING IN PROJECTS</span></div><span className="chip">MANUFACTURER INTELLIGENCE</span></header>
        <div className="content">
          <div className="page-head"><div><span className="eyebrow">SPEC</span><h1>SEE WHAT IS BEING DESIGNED IN.</h1><p>Track manufacturers and products across active projects and pre-RFP evidence, then connect specification activity back to owners, engineers and upcoming pursuits.</p></div><input className="searchbar" placeholder="Search Genetec, Axis, Mercury LP4502…" /></div>
          <section className="two-col">
            <article className="panel"><div className="panel-head"><div><span>SPEC ACTIVITY</span><h2>Manufacturers showing up most often</h2></div><small>Verified mentions</small></div><div className="bar-list">{specs.map(item => <div className="bar-item" key={`${item.manufacturer}-${item.product || "all"}`}><div className="bar-title"><strong>{item.manufacturer}{item.product ? ` · ${item.product}` : ""}</strong><span>{item.activeProjects} projects</span></div><div className="bar-track"><i style={{width:`${(item.activeProjects/max)*100}%`}} /></div></div>)}</div></article>
            <article className="panel"><div className="panel-head"><div><span>EARLY ACTIVITY</span><h2>Specifications detected before solicitation</h2></div><small>Evidence-backed</small></div><div className="feed">{[...specs].sort((a,b)=>b.preRfpProjects-a.preRfpProjects || b.activeProjects-a.activeProjects).map(item => <div className="feed-row" key={`m-${item.manufacturer}-${item.product || "all"}`}><span className="feed-time">{item.preRfpProjects}</span><div className="feed-copy"><strong>{item.manufacturer}{item.product ? ` · ${item.product}` : ""}</strong><span>{item.preRfpProjects} projects detected pre-RFP</span></div><span className="score">{item.activeProjects}</span></div>)}</div></article>
          </section>
          <div className="stack section-gap">{specs.map(item => <article className="spec-card" key={`c-${item.manufacturer}-${item.product || "all"}`}><div className="card-top"><span>{item.manufacturer.toUpperCase()}{item.product ? ` · ${item.product}` : ""}</span><strong>{item.preRfpProjects} PRE-RFP</strong></div><h3>{item.activeProjects} active projects · {item.preRfpProjects} detected before RFP</h3><p>Estimated project value associated with tracked appearances: {money(item.estimatedProjectValue)}.</p>{item.pairedWith.length > 0 && <div className="tag-row"><span className="tag">COMMONLY PAIRED</span>{item.pairedWith.map(pair => <span className="tag" key={pair}>{pair}</span>)}</div>}</article>)}</div>
          <div className="footer-note">SPEC retains project evidence and the manufacturer/product reference behind each record. No product association is inferred from contractor identity alone.</div>
        </div>
      </section>
    </main>
  );
}
