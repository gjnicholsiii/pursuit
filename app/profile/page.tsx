import Link from "next/link";
import { Sidebar } from "@/components/sidebar";
import { getCurrentCustomerProfile } from "@/lib/customer-profile";
import { getSql } from "@/lib/db";
import { saveProfileAction } from "./actions";
import "./profile.css";

export const dynamic = "force-dynamic";
function join(items: string[]) { return items.join(", "); }

type QualificationRow={bonding_limit:string|number|null;contract_vehicles:string[]|null};

export default async function ProfilePage() {
  const profile = await getCurrentCustomerProfile();
  let qualification:QualificationRow|null=null;
  if(profile){const rows=await getSql().query(`select bonding_limit,contract_vehicles from selling_profiles where organization_id=$1 order by updated_at desc limit 1`,[profile.organizationId]) as QualificationRow[];qualification=rows[0]||null}

  return (
    <main className="shell">
      <Sidebar active="Profile" />
      <section className="workspace">
        <header className="topbar"><Link href="/" className="searchbox"><span>Back to Your Opportunities</span></Link></header>
        <div className="content">
          <div className="hero-row inventory-hero"><div><span className="eyebrow">SELLING PROFILE</span><h1>WHAT SHOULD PURSUIT FIND FOR YOU?</h1><p>Enter your markets and real company qualifications once. Pursuit uses them first to rank relevant opportunities, then to test actual bid requirements when you run GO / NO-GO.</p></div></div>

          <form action={saveProfileAction} className="profile-form">
            <label><span>Company name</span><input name="organizationName" required defaultValue={profile?.organizationName || ""} placeholder="Your company" /></label>
            <label><span>NAICS codes</span><input name="naicsCodes" defaultValue={join(profile?.naicsCodes || [])} placeholder="561621, 238210" /><small>Comma separated. These drive the first-pass opportunity feed.</small></label>
            <label><span>PSC / product-service codes</span><input name="pscCodes" defaultValue={join(profile?.pscCodes || [])} placeholder="J063, 6350" /><small>Comma separated. Pursuit matches these against federal classification codes.</small></label>
            <label className="profile-wide"><span>Capabilities and buying terms</span><textarea name="capabilityTerms" defaultValue={join(profile?.capabilityTerms || [])} placeholder="access control, video surveillance, structured cabling" rows={4} /><small>Use the language buyers use, including products, services and common project terms.</small></label>
            <label><span>Territories</span><input name="territories" defaultValue={join(profile?.territories || [])} placeholder="IL, IN, WI or NATIONAL" /><small>Two-letter state codes, or NATIONAL.</small></label>
            <label><span>Certifications, licenses and authorizations</span><input name="certifications" defaultValue={join(profile?.certifications || [])} placeholder="SDVOSB, Genetec certified, Illinois PERC" /><small>Include manufacturer certifications, trade licenses and socioeconomic certifications that can qualify you for work.</small></label>
            <label><span>Small-business / set-aside statuses</span><input name="smallBusinessStatuses" defaultValue={join(profile?.smallBusinessStatuses || [])} placeholder="Small Business, SDVOSB, WOSB" /></label>
            <label><span>Contract vehicles</span><input name="contractVehicles" defaultValue={join(qualification?.contract_vehicles || [])} placeholder="GSA MAS, Sourcewell, OMNIA" /><small>Include cooperative and government contract vehicles you can sell through.</small></label>
            <label><span>Bonding limit</span><input name="bondingLimit" inputMode="decimal" defaultValue={qualification?.bonding_limit ?? ""} placeholder="5000000" /><small>Pursuit can compare explicit bid and performance bond thresholds against this limit.</small></label>
            <label><span>Minimum contract value</span><input name="minContractValue" inputMode="decimal" defaultValue={profile?.minContractValue ?? ""} placeholder="25000" /></label>
            <label><span>Maximum contract value</span><input name="maxContractValue" inputMode="decimal" defaultValue={profile?.maxContractValue ?? ""} placeholder="2500000" /></label>
            <div className="profile-wide profile-actions"><button type="submit" className="filter-button">Save profile and build my feed</button></div>
          </form>
        </div>
      </section>
    </main>
  );
}
