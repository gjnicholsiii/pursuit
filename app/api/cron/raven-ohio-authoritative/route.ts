import { GET as runArkansasBulk } from "../raven-arkansas-authoritative/route";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  return runArkansasBulk(req);
}
