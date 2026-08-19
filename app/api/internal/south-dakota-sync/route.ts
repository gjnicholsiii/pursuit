import { NextResponse } from "next/server";
import { syncSouthDakotaEsm } from "@/lib/sled/south-dakota";
import { syncSouthDakotaDot } from "@/lib/sled/south-dakota-dot";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET() {
  const [esm, dot] = await Promise.all([syncSouthDakotaEsm(), syncSouthDakotaDot()]);
  const ok = esm.ok && dot.ok;
  return NextResponse.json({ ok, esm, dot }, { status: ok ? 200 : 500 });
}
