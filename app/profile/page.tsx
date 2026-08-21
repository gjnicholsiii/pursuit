import Link from "next/link";
import { Sidebar } from "@/components/sidebar";
import { getCurrentCustomerProfile } from "@/lib/customer-profile";
import { saveProfileAction } from "./actions";
import "./profile.css";

export const dynamic = "force-dynamic";

function join(items: string[]) {
  return items.join(", ");
}

export default async function ProfilePage() {
  const profile = await getCurrentCustomerProfile();

  return (
    <main className="shell">
      <Sidebar active="Profile" />
      <section className="workspace">
        <header className="topbar">
          <Link href="/" className="searchbox"><span>Back to Your Opportunities</span></Link>
        </header>
        <div className="content">
          <div className="hero-row inventory-hero">
            <div>
              <span className="eyebrow">SELLING PROFILE</span>
              <h1>WHAT SHOULD PURSUIT FIND FOR YOU?</h1>
              <p>This profile controls your homepage matches. Add only the markets, codes and capabilities you actually want Pursuit to surface.</p>
            </div>
          </div>

          <form action={saveProfileAction} className="profile-form">
            <label>
              <span>Company name</span>
              <input name="organizationName" required defaultValue={profile?.organizationName || ""} placeholder="Your company" />
            </label>
            <label>
              <span>NAICS codes</span>
              <input name="naicsCodes" defaultValue={join(profile?.naicsCodes || [])} placeholder="561621, 238210" />
              <small>Comma separated.</small>
            </label>
            <label>
              <span>PSC / product-service codes</span>
              <input name="pscCodes" defaultValue={join(profile?.pscCodes || [])} placeholder="J063, 6350" />
              <small>Comma separated. Pursuit matches these against federal classification codes.</small>
            </label>
            <label className="profile-wide">
              <span>Capabilities and buying terms</span>
              <textarea name="capabilityTerms" defaultValue={join(profile?.capabilityTerms || [])} placeholder="access control, video surveillance, structured cabling" rows={4} />
              <small>Use the language buyers use, including products, services and common project terms.</small>
            </label>
            <label>
              <span>Territories</span>
              <input name="territories" defaultValue={join(profile?.territories || [])} placeholder="IL, IN, WI or NATIONAL" />
              <small>Two-letter state codes, or NATIONAL.</small>
            </label>
            <label>
              <span>Certifications</span>
              <input name="certifications" defaultValue={join(profile?.certifications || [])} placeholder="8(a), HUBZone, DBE" />
            </label>
            <label>
              <span>Small-business / set-aside statuses</span>
              <input name="smallBusinessStatuses" defaultValue={join(profile?.smallBusinessStatuses || [])} placeholder="Small Business, SDVOSB, WOSB" />
            </label>
            <label>
              <span>Minimum contract value</span>
              <input name="minContractValue" inputMode="decimal" defaultValue={profile?.minContractValue ?? ""} placeholder="25000" />
            </label>
            <label>
              <span>Maximum contract value</span>
              <input name="maxContractValue" inputMode="decimal" defaultValue={profile?.maxContractValue ?? ""} placeholder="2500000" />
            </label>
            <div className="profile-wide profile-actions">
              <button type="submit" className="filter-button">Save profile and build my feed</button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
