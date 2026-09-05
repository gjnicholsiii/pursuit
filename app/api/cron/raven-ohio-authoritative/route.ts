import { NextRequest, NextResponse } from "next/server";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Ohio OEDS export integration is not yet implemented. This endpoint must NOT
// redirect into another state's worker: doing so caused Idaho's same residual
// districts to be retried twice per cron cycle and defeated the durable queue.
// Fail closed until the OEDS statewide export parser is implemented.
export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  return NextResponse.json(
    {
      ok: false,
      state: "OH",
      blocker: "Ohio OEDS statewide POST/export parser is not implemented; worker intentionally does not retry another state's queue.",
      districtsNewlyAttempted: 0,
    },
    { status: 503 },
  );
}
