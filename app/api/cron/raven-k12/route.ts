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
    const active=await sql.query(`select count(*)::int n from raven_enrichment_runs where status='running' and started_at>now()-interval '6 minutes'`) as Array<{n:number}>;
    if(Number(active[0]?.n||0)>0)return NextResponse.json({ok:true,skipped:true,reason:'Raven K-12 batch already running',running:Number(active[0]?.n||0)});
    await sql.query(`update raven_enrichment_runs set status='failed',completed_at=now(),diagnostics=coalesce(diagnostics,'{}'::jsonb)||jsonb_build_object('error','stale enrichment lease expired') where status='running' and started_at<=now()-interval '6 minutes'`);

    // Preserve most of the runtime budget for the actual district enrichment pass.
    // Official-site reconciliation has its own recurring worker, so this cron only
    // advances one unresolved identity per invocation before enriching one district.
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 1);
    const limit = Math.max(1, Math.min(requestedLimit, 1));
    const identity = await resolveK12OfficialSites(1);
    const result = await enrichK12Batch(limit);
    const removed=await sql.query(`delete from raven_people where source_type='public_web' and full_name ~* '(quick links|in this section|testing|environmental|air quality|water.*testing|road$|street$|avenue$|boulevard$|highway$|^event details$|^scroll down$|^please register|^new student enrollment$|^view spending$|^committee members$|^term expires$|^current bids$|^watch the latest meeting$)' returning id`);
    return NextResponse.json({ ok: true, identity, ...result, falsePeopleRemoved: removed.length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
