import { NextResponse } from "next/server";
import { syncAlabamaStaarsVss } from "@/lib/sled/alabama";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const result = await syncAlabamaStaarsVss();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
