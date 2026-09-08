import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";
import { extractText } from "unpdf";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE = "https://www.maine.gov/doe/sites/maine.gov.doe/files/inline-files/Supervision%20and%20Monitoring%20-%202025-2026%20Special%20Education%20Directory%20-%207.17.2025.pdf";

type Contact = { district: string; fullName: string; email: string | null; phone: string | null };
type Slot = { id: string; canonical_name: string | null };

function clean(v: unknown) {
  return String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function norm(v: unknown) {
  return clean(v)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(school department|school district|school administrative district|school administrative unit|schools|school|district|public)\b/g, " ")
    .replace(/\bregional school unit\b/g, " rsu ")
    .replace(/\bmaine school administrative district\b/g, " msad ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function blockedDistrict(v: string) {
  return /charter|academy|private|parochial|catholic|university|college|education in unorganized territories|special purpose|service center|regional service center/i.test(v);
}

async function roster() {
  const r = await fetch(SOURCE, {
    cache: "no-store",
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0 (compatible; Pursuit-Raven/11.1; authoritative-statewide-roster)" },
  });
  if (!r.ok) throw new Error(`Maine DOE directory HTTP ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const extracted = await extractText(bytes, { mergePages: true });
  const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : String(extracted.text ?? "");
  if (!text.includes("Superintendent:")) throw new Error("Maine DOE parser guard: superintendent fields not found");

  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const out: Contact[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/^Superintendent:\s*/i.test(lines[i])) continue;
    const fullName = clean(lines[i].replace(/^Superintendent:\s*/i, ""));
    if (!fullName || fullName.split(/\s+/).length < 2) continue;

    let district = "";
    for (let j = i - 1; j >= Math.max(0, i - 14); j--) {
      const candidate = clean(lines[j]);
      if (!candidate) continue;
      if (/^[A-Z0-9 .,'&()\/-]{4,}$/.test(candidate) && !/^(DIRECTOR|ADMIN|FISCAL|PHONE|EMAIL|PH|SUPERINTENDENT)/i.test(candidate)) {
        district = candidate;
        break;
      }
    }
    if (!district || blockedDistrict(district)) continue;

    let email: string | null = null;
    let phone: string | null = null;
    for (let j = i + 1; j <= Math.min(lines.length - 1, i + 5); j++) {
      const e = lines[j].match(/^Superintendent Email:\s*([^\s]+@[^\s]+)$/i);
      if (e) email = e[1].replace(/[;,]+$/, "");
      const p = lines[j].match(/^Superintendent Phone:\s*(.+)$/i);
      if (p) phone = clean(p[1]);
    }
    out.push({ district, fullName, email, phone });
  }

  const deduped = [...new Map(out.map((x) => [norm(x.district), x])).values()];
  if (deduped.length < 60) throw new Error(`Maine DOE parser guard: only ${deduped.length} superintendent records parsed`);
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
     where state_code='ME' and scope='district' and role_key='superintendent'
  `) as any[])[0];

  let list: Contact[] = [];
  try {
    list = await roster();
  } catch (e) {
    return NextResponse.json({ ok: false, state: "ME", source: SOURCE, blocker: e instanceof Error ? e.message : String(e), before }, { status: 502 });
  }

  const slots = await sql.query(`
    select c.id::text, a.canonical_name
      from raven_state_contacts c
      left join agencies a on a.id=c.agency_id
     where c.state_code='ME' and c.scope='district' and c.role_key='superintendent'
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
             email=$3,
             phone=$4,
             source_url=$5,
             verification_status='verified',
             verified_at=now(),
             evidence_note='Current superintendent contact published in the Maine Department of Education 2025-2026 statewide Special Education Directory.',
             updated_at=now()
       where id=$1
         and verification_status in ('missing','candidate','rejected')
       returning id
    `, [s.id, c.fullName, c.email, c.phone, SOURCE]) as any[];
    written += u.length;
  }

  const after = (await sql.query(`
    select count(*)::int slots,
           count(*) filter(where verification_status='verified')::int verified,
           count(*) filter(where verification_status='candidate')::int candidate,
           count(*) filter(where verification_status='missing')::int missing,
           count(*) filter(where verification_status='rejected')::int rejected
      from raven_state_contacts
     where state_code='ME' and scope='district' and role_key='superintendent'
  `) as any[])[0];

  return NextResponse.json({
    ok: true,
    state: "ME",
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
