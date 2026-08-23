import { NextRequest, NextResponse } from "next/server";
import { enrichK12Batch } from "@/lib/raven/k12-enrichment";
import { resolveK12OfficialSites } from "@/lib/raven/k12-official-site";
import { requireInternalAuth } from "@/lib/internal-auth";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = requireInternalAuth(request);
  if (auth) return auth;

  try {
    const sql=getSql();
    const active=await sql.query(`select count(*)::int n from raven_enrichment_runs where status='running' and started_at>now()-interval '4 minutes'`) as Array<{n:number}>;
    if(Number(active[0]?.n||0)>0)return NextResponse.json({ok:true,skipped:true,reason:'Raven K-12 batch already running',running:Number(active[0]?.n||0)});
    await sql.query(`update raven_enrichment_runs set status='failed',completed_at=now(),diagnostics=coalesce(diagnostics,'{}'::jsonb)||jsonb_build_object('error','stale enrichment lease expired') where status='running' and started_at<=now()-interval '4 minutes'`);
    const limit = Number(request.nextUrl.searchParams.get("limit") || 9);
    const identity = await resolveK12OfficialSites(60);
    const result = await enrichK12Batch(limit);
    return NextResponse.json({ ok: true, identity, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
