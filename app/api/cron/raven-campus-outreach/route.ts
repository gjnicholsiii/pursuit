import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CAMPAIGN = "campus-security-advisory-v1";
const SIZE = 500;
const TARGET = 1000;
const CONCURRENCY = 20;

const first = (s: string) => (s || "").trim().split(/\s+/)[0] || "there";

function eligible(title: string, family: string) {
  const t = (title || "").toLowerCase();
  if (/principal|teacher|board|finance|financial|procurement|purchasing|facilit|maintenance|vendor/.test(t)) return false;
  if (family === "Executive") return /\b(superintendent|assistant superintendent|deputy superintendent)\b/.test(t);
  if (family === "Security") return /(chief|director|executive director|manager).*(security|safety|school safety|public safety|emergency management)|(security|safety|school safety|public safety|emergency management).*(chief|director|executive director|manager)/.test(t);
  if (family === "Technology") return /\b(cio|cto)\b|director.*(it|information technology|technology|information systems|infrastructure|network services)|(it|technology) manager|chief.*(information|technology)/.test(t);
  return false;
}

function copy(name: string, institution: string) {
  return `Hi ${name},\n\nI spent years on the bidder side of school security projects, which taught me exactly where security programs become expensive, difficult to maintain, or obsolete long before anyone intended. Blackvane now works from the owner side, helping districts make those decisions before an RFP locks them in.\n\nWe provide independent security assessment, system design, procurement support, and project oversight. A major part of that work is a ten-year security technology roadmap for ${institution}, built around viability, survivability, lifecycle planning, and preventing overspending as systems age and requirements change.\n\nWe also offer a pre-RFP Bidder's Review: an independent review from the perspective of the companies that will eventually price and respond to the package, before it reaches the street. That catches ambiguity, unnecessary cost, scope conflicts, and procurement problems while they are still inexpensive to correct.\n\nIf a conversation would be useful, I'd be glad to compare notes.\n\nJoe Nichols\nBlackvane 13\nblackvane13.com`;
}

async function sendOne(sql: ReturnType<typeof getSql>, row: any, key: string, from: string) {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [row.email],
        subject: "A bidder-side review before your next security RFP",
        text: copy(row.first_name || first(row.full_name), row.institution || "your district"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.message || `Resend ${response.status}`);
    await sql.query(`update raven_outreach_sends set status='sent',provider_message_id=$3,sent_at=now(),error=null where batch_id=$1 and person_id=$2 and status<>'sent'`, [row.batch_id, row.person_id, body.id || null]);
    return true;
  } catch (error) {
    await sql.query(`update raven_outreach_sends set status='failed',error=$3 where batch_id=$1 and person_id=$2 and status<>'sent'`, [row.batch_id, row.person_id, error instanceof Error ? error.message : String(error)]);
    return false;
  }
}

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  const totalRows = await sql.query(`select count(*)::int n from raven_outreach_sends s join raven_outreach_batches b on b.id=s.batch_id where b.campaign=$1 and s.status='sent'`, [CAMPAIGN]) as any[];
  const total = Number(totalRows[0]?.n || 0);
  if (total >= TARGET) return NextResponse.json({ ok: true, complete: true, sent: total });

  const activeRows = await sql.query(`select b.id::text,b.batch_number from raven_outreach_batches b where b.campaign=$1 and b.status in('sending','partial') order by b.batch_number limit 1`, [CAMPAIGN]) as any[];
  let batchId = activeRows[0]?.id as string | undefined;
  let batchNumber = Number(activeRows[0]?.batch_number || 0);

  if (!batchId) {
    const existing = await sql.query(`select count(*)::int n from raven_outreach_batches where campaign=$1`, [CAMPAIGN]) as any[];
    batchNumber = Number(existing[0]?.n || 0) + 1;
    if (batchNumber > 2) return NextResponse.json({ ok: true, complete: total >= TARGET, sent: total });

    const rows = await sql.query(`select distinct on(lower(rp.email)) rp.id::text person_id,rp.full_name,rp.title,rp.role_family,rp.email,a.canonical_name institution from raven_people rp join agencies a on a.id=rp.agency_id where a.agency_type='k12' and rp.email is not null and btrim(rp.email)<>'' and rp.role_family in('Executive','Security','Technology') and not exists(select 1 from raven_outreach_sends s where lower(s.email)=lower(rp.email)) order by lower(rp.email),rp.confidence desc nulls last,rp.last_verified_at desc nulls last`) as any[];
    const qualified = rows.filter(r => eligible(r.title, r.role_family));
    if (qualified.length < SIZE) return NextResponse.json({ ok: true, skipped: true, qualified: qualified.length, needed: SIZE, totalSuccessful: total });

    const br = await sql.query(`insert into raven_outreach_batches(campaign,batch_number,status,target_count) values($1,$2,'sending',$3) returning id::text`, [CAMPAIGN, batchNumber, SIZE]) as any[];
    batchId = br[0].id;
    const frozen = qualified.slice(0, SIZE);
    for (const r of frozen) {
      await sql.query(`insert into raven_outreach_sends(batch_id,person_id,email,status,first_name,full_name,institution,title) values($1,$2,$3,'pending',$4,$5,$6,$7)`, [batchId, r.person_id, r.email, first(r.full_name), r.full_name, r.institution, r.title]);
    }
  }

  const key = process.env.RESEND_API_KEY;
  const from = process.env.BLACKVANE_OUTBOUND_FROM || process.env.OUTREACH_FROM_EMAIL;
  if (!key || !from) return NextResponse.json({ ok: false, error: "Blackvane outbound sender is not configured for Raven", batch: batchNumber }, { status: 500 });

  const pending = await sql.query(`select s.batch_id::text,s.person_id,s.email,s.first_name,s.full_name,s.institution,s.title from raven_outreach_sends s where s.batch_id=$1 and s.status in('pending','failed') order by s.id`, [batchId]) as any[];
  let sentNow = 0;
  let failedNow = 0;
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const results = await Promise.all(pending.slice(i, i + CONCURRENCY).map(r => sendOne(sql, r, key, from)));
    sentNow += results.filter(Boolean).length;
    failedNow += results.filter(v => !v).length;
  }

  const counts = await sql.query(`select count(*) filter(where status='sent')::int sent,count(*) filter(where status='failed')::int failed,count(*)::int total from raven_outreach_sends where batch_id=$1`, [batchId]) as any[];
  const batchSent = Number(counts[0]?.sent || 0);
  const batchFailed = Number(counts[0]?.failed || 0);
  const done = batchSent === SIZE;
  await sql.query(`update raven_outreach_batches set status=$2,sent_count=$3,failed_count=$4,completed_at=case when $2='sent' then now() else null end where id=$1`, [batchId, done ? "sent" : "partial", batchSent, batchFailed]);

  const totalSuccessful = total + sentNow;
  return NextResponse.json({ ok: true, batch: batchNumber, sent: sentNow, failed: failedNow, batchSent, batchFailed, totalSuccessful, complete: totalSuccessful >= TARGET });
}
