import Link from "next/link";
import { Activity, Crosshair, FileSearch, Radar, RefreshCcw, ScanSearch, ShieldCheck } from "lucide-react";

const items = [
  { label: "Overwatch", icon: Radar, href: "/" },
  { label: "Signals", icon: Activity, href: "/signals" },
  { label: "Pursuits", icon: Crosshair, href: "/pursuits" },
  { label: "Rebids", icon: RefreshCcw, href: "/rebids" },
  { label: "Incumbents", icon: ShieldCheck, href: "/incumbents" },
  { label: "Spec", icon: FileSearch, href: "/spec" },
];

export function Sidebar({ active = "Overwatch" }: { active?: string }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><ScanSearch size={18} /></div>
        <div>
          <strong>PURSUIT</strong>
          <span>LOW VOLTAGE INTELLIGENCE</span>
        </div>
      </div>
      <div className="overwatch-sequence">
        <span>OVERWATCH</span>
        <strong>DISCOVER → PREDICT → IDENTIFY → PURSUE</strong>
      </div>
      <nav>
        {items.map(({ label, icon: Icon, href }) => (
          <Link key={label} href={href} className={active === label ? "nav-item active" : "nav-item"}>
            <Icon size={17} strokeWidth={1.8} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="source-health">
          <div className="source-health-top"><span>LV TAXONOMY</span><strong>9 disciplines</strong></div>
          <small>Security · fire · cabling · AV · nurse call · DAS</small>
        </div>
      </div>
    </aside>
  );
}
