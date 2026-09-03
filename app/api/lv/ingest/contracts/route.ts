import { NextRequest, NextResponse } from "next/server";
import { discoverFederalLVContracts } from "@/lib/lv-usaspending";
import { persistLVContract } from "@/lib/lv-contract-persistence";
import { lowVoltageDatabaseConfigured } from "@/lib/lv-persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const pages = Math.max(1, Math.min(8, Number(request.nextUrl.searchParams.get("pages") || 3)));
  const persist = request.nextUrl.searchParams.get("persist") === "1";
  const result = await discoverFederalLVContracts(pages);

  let persisted = 0;
  if (persist && lowVoltageDatabaseConfigured()) {
    for (const contract of result.contracts) {
      const stored = await persistLVContract(contract);
      if (stored.stored) persisted += 1;
    }
  }

  const incumbentTotals = new Map<string, { contracts: number; value: number }>();
  for (const contract of result.contracts) {
    const current = incumbentTotals.get(contract.incumbent) || { contracts: 0, value: 0 };
    current.contracts += 1;
    current.value += contract.amount;
    incumbentTotals.set(contract.incumbent, current);
  }

  return NextResponse.json({
    source: "USAspending",
    naics: result.naics,
    scanned: result.scanned,
    accepted: result.accepted,
    databaseConfigured: lowVoltageDatabaseConfigured(),
    persisted,
    failures: result.failures,
    incumbents: [...incumbentTotals.entries()]
      .map(([incumbent, totals]) => ({ incumbent, ...totals }))
      .sort((a, b) => b.value - a.value),
    rebids: result.contracts.filter(item => item.rebid.score >= 55).map(item => ({
      awardId: item.awardId,
      incumbent: item.incumbent,
      agency: item.agency,
      subAgency: item.subAgency,
      description: item.description,
      amount: item.amount,
      endDate: item.endDate,
      probability: item.rebid.score,
      band: item.rebid.band,
      procurementWindow: item.rebid.procurementWindow,
      reasons: item.rebid.reasons,
      disciplines: item.classification.disciplines,
      manufacturers: item.classification.manufacturers,
    })),
  });
}
