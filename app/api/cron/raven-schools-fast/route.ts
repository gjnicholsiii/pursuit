import { GET as runOklahomaBulk } from "../raven-oklahoma-authoritative/route";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request:NextRequest){
  return runOklahomaBulk(request);
}
