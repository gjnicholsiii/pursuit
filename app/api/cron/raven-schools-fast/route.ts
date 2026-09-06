import { GET as runDurableK12Queue } from "../raven-k12/route";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const response = await runDurableK12Queue(request);
  try {
    const body = await response.clone().json();
    console.log("RAVEN_SCHOOLS_FAST_DURABLE_QUEUE", body);
  } catch (e) {
    console.log("RAVEN_SCHOOLS_FAST_LOG_ERROR", String(e));
  }
  return response;
}
