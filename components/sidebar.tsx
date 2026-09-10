import Link from "next/link";
import { Activity, Binoculars, Radar, Settings2, Target } from "lucide-react";
import { demoHref } from "@/lib/demo-mode";

const items = [
  { label: "Revenue Today", icon: Activity, href: "/" },
  { label: "Opportunities", icon: Target, href: "/opportunities" },
  { label: "Overwatch", icon: Radar, href: "/overwatch" },
  { label: "Raven", icon: Binoculars, href: "/raven" },
  { label: "Profile", icon: Settings2, href: "/profile" },
];

export function Sidebar({ active = "Revenue Today", demo = false }: { active?: string; demo?: boolean }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">P</div>
        <div>
          <strong>Pursuit</strong>
          <span>{demo ? "Four-State Low-Voltage Demo" : "Government Revenue Intelligence"}</span>
        </div>
      </div>
      <nav>
        {items.map(({ label, icon: Icon, href }) => (
          <Link key={label} href={demoHref(href, demo)} className={active === label ? "nav-item active" : "nav-item"}>
            <Icon size={17} strokeWidth={1.8} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="source-health">
          <div className="source-health-top"><span>Data sources</span><strong>Federal + SLED live</strong></div>
          <small>{demo ? "IN · OH · KY · TN · federal · state · local · education" : "SAM.gov · USAspending · state · local · K-12 · higher ed"}</small>
        </div>
      </div>
    </aside>
  );
}
