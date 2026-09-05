import { GET as runOklahomaBulk } from "../raven-oklahoma-authoritative/route";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request:NextRequest){
  const response = await runOklahomaBulk(request);
  try {
    const body = await response.clone().json();
    console.log('RAVEN_OKLAHOMA_BULK', body);
  } catch (e) {
    console.log('RAVEN_OKLAHOMA_BULK_LOG_ERROR', String(e));
  }
  return response;
}
