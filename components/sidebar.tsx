import Link from "next/link";
import { Activity, Target, Search } from "lucide-react";

const items = [
  { label: "Revenue Today", icon: Activity, href: "/" },
  { label: "Opportunities", icon: Target, href: "/opportunities" },
  { label: "Search", icon: Search, href: "/opportunities" },
];

export function Sidebar({ active = "Revenue Today" }: { active?: string }) {
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
        {items.map(({ label, icon: Icon, href }) => (
          <Link key={label} href={href} className={active === label ? "nav-item active" : "nav-item"}>
            <Icon size={17} strokeWidth={1.8} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="source-health">
          <div className="source-health-top"><span>Data sources</span><strong>Federal + SLED live</strong></div>
          <small>SAM.gov · state · local · K-12 · higher ed</small>
        </div>
      </div>
    </aside>
  );
}
