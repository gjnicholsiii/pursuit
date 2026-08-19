import { NextResponse } from "next/server";
import { syncArkansasSasAriba } from "@/lib/sled/arkansas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const result = await syncArkansasSasAriba();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
