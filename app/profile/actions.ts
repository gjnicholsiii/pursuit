"use server";

import { redirect } from "next/navigation";
import { saveCustomerProfile } from "@/lib/customer-profile";

function list(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return [];
  return value
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => item.toUpperCase());
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

  await saveCustomerProfile({
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

  redirect("/");
}
