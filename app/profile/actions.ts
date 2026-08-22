"use server";

import { redirect } from "next/navigation";
import { saveCustomerProfile } from "@/lib/customer-profile";
import { getSql } from "@/lib/db";

function list(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return [];
  return value.split(/[\n,]/).map(item => item.trim()).filter(Boolean).map(item => item.toUpperCase());
}
function terms(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return [];
  return value.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
}
function money(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function saveProfileAction(formData: FormData) {
  const organizationName = String(formData.get("organizationName") || "").trim();
  if (!organizationName) redirect("/profile?error=name");

  const organizationId=await saveCustomerProfile({
    organizationName,
    territories: list(formData.get("territories")),
    capabilityTerms: terms(formData.get("capabilityTerms")),
    naicsCodes: list(formData.get("naicsCodes")),
    pscCodes: list(formData.get("pscCodes")),
    certifications: terms(formData.get("certifications")),
    smallBusinessStatuses: terms(formData.get("smallBusinessStatuses")),
    minContractValue: money(formData.get("minContractValue")),
    maxContractValue: money(formData.get("maxContractValue")),
  });

  await getSql().query(
    `update selling_profiles set bonding_limit=$2,contract_vehicles=$3,updated_at=now() where id=(select id from selling_profiles where organization_id=$1 order by updated_at desc limit 1)`,
    [organizationId,money(formData.get("bondingLimit")),terms(formData.get("contractVehicles"))],
  );

  redirect("/");
}
