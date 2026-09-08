import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://fliphtml5.com/masaleads/tupc/2025-26_MASA_Membership_Directory/";

type Contact = { district: string; fullName: string };
type Slot = { id: string; canonical_name: string | null };

function clean(v: unknown) {
  return String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function norm(v: unknown) {
  return clean(v)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(school district|school districts|schools|school|district|public)\b/g, " ")
    .replace(/\bcounty\b/g, " co ")
    .replace(/\bst\[.]?\b/g, " saint ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function blockedDistrict(v: string) {
  return /charter|academy|private|parochial|catholic|university|college|special school district|schools for the sev|service agency|cooperative|coop\b|vocational|career center/i.test(v);
}

async function roster() {
  const r = await fetch(SOURCE, {
    cache: "no-store",
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; Pursuit-Raven/11.0; authoritative-statewide-roster)",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!r.ok) throw new Error(`MASA directory HTTP ${r.status}`);

  const $ = cheerio.load(await r.text());
  const raw = $("body").text();
  const lines = raw.split(/\r?\n/).map(clean).filter(Boolean);
  const start = lines.findIndex((x) => x === "ACTIVE MEMBERS");
  const end = lines.findIndex((x, i) => i > start && /NON-VOTING GROUP MEMBERS|EMERITUS MEMBERS/i.test(x));
  if (start < 0) throw new Error("MASA parser guard: ACTIVE MEMBERS section not found");
  const section = lines.slice(start, end > start ? end : undefined);
  const out: Contact[] = [];

  for (let i = 1; i < section.length - 1; i++) {
    if (section[i] !== "Superintendent") continue;
    const fullName = section[i - 1];
    const district = section[i + 1];
    if (!fullName || !district) continue;
    if (fullName.split(/\s+/).length < 2) continue;
    if (blockedDistrict(district)) continue;
    if (/assistant|associate|deputy|director|chief/i.test(fullName)) continue;
    out.push({ district, fullName });
  }

  const deduped = [...new Map(out.map((x) => [norm(x.district), x])).values()];
  if (deduped.length < 250) {
    throw new Error(`MASA parser guard: only ${deduped.length} superintendent records parsed`);
  }
  return deduped;
}

function match(c: Contact, slots: Slot[]) {
  const k = norm(c.district);
  let a = slots.filter((s) => norm(s.canonical_name) === k);
  if (a.length === 1) return a[0];
  a = slots.filter((s) => {
    const x = norm(s.canonical_name);
    return x && k && (x.includes(k) || k.includes(x));
  });
  return a.length === 1 ? a[0] : null;
}

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();
  const before = (await sql.query(`
    select count(*)::int slots,
           count(*) filter(where verification_status='verified')::int verified,
           count(*) filter(where verification_status='candidate')::int candidate,
           count(*) filter(where verification_status='missing')::int missing,
           count(*) filter(where verification_status='rejected')::int rejected
      from raven_state_contacts
     where state_code='MO' and scope='district' and role_key='superintendent'
  `) as any[])[0];

  let list: Contact[] = [];
  try {
    list = await roster();
  } catch (e) {
    return NextResponse.json({ ok: false, state: "MO", source: SOURCE, blocker: e instanceof Error ? e.message : String(e), before }, { status: 502 });
  }

  const slots = await sql.query(`
    select c.id::text, a.canonical_name
      from raven_state_contacts c
      left join agencies a on a.id=c.agency_id
     where c.state_code='MO' and c.scope='district' and c.role_key='superintendent'
  `) as Slot[];

  let matched = 0;
  let written = 0;
  const unmatched: string[] = [];
  for (const c of list) {
    const s = match(c, slots);
    if (!s) { unmatched.push(c.district); continue; }
    matched++;
    const u = await sql.query(`
      update raven_state_contacts
         set full_name=$2,
             title='Superintendent',
             source_url=$3,
             verification_status='verified',
             verified_at=now(),
             evidence_note='Current superintendent published in the Missouri Association of School Administrators 2025-2026 statewide membership directory.',
             updated_at=now()
       where id=$1
         and verification_status in ('missing','candidate','rejected')
       returning id
    `, [s.id, c.fullName, SOURCE]) as any[];
    written += u.length;
  }

  const after = (await sql.query(`
    select count(*)::int slots,
           count(*) filter(where verification_status='verified')::int verified,
           count(*) filter(where verification_status='candidate')::int candidate,
           count(*) filter(where verification_status='missing')::int missing,
           count(*) filter(where verification_status='rejected')::int rejected
      from raven_state_contacts
     where state_code='MO' and scope='district' and role_key='superintendent'
  `) as any[])[0];

  return NextResponse.json({
    ok: true,
    state: "MO",
    source: SOURCE,
    parsed: list.length,
    matched,
    written,
    unmatchedSourceRecords: unmatched.length,
    unmatchedSample: unmatched.slice(0, 25),
    before,
    after,
    verifiedAdded: Number(after.verified) - Number(before.verified),
  });
}
