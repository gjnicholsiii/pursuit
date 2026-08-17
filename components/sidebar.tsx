import { Activity, BadgeCheck, Building2, FileSearch, Landmark, Route, Search, Settings2, Target } from "lucide-react";

const items = [
  { label: "Revenue Today", icon: Activity, active: true },
  { label: "Opportunities", icon: Target },
  { label: "Ready for Government", icon: BadgeCheck },
  { label: "Path to Award", icon: Route },
  { label: "Pipeline", icon: FileSearch },
  { label: "Agencies", icon: Building2 },
  { label: "Contracts", icon: Landmark },
  { label: "Search", icon: Search },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">P</div>
        <div>
          <strong>Pursuit</strong>
          <span>Government Revenue Intelligence</span>
        </div>
      </div>
      <nav>
        {items.map(({ label, icon: Icon, active }) => (
          <button key={label} className={active ? "nav-item active" : "nav-item"}>
            <Icon size={17} strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="source-health">
          <div className="source-health-top"><span>Source health</span><strong>99.4%</strong></div>
          <div className="health-bar"><i /></div>
          <small>Federal + SLED sources monitored</small>
        </div>
        <button className="nav-item"><Settings2 size={17} /><span>Selling profile</span></button>
      </div>
    </aside>
  );
}
