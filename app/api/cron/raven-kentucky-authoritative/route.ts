import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const KDE_DIRECTORY = "https://applications.education.ky.gov/SDCI/District.aspx/1000";

type KdeRow = { district: string; fullName: string; phone: string };
type MissingSlot = { id: string; county: string | null; canonical_name: string | null };

function clean(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function stripHonorific(value: string) {
  return clean(value).replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.|Miss)\s+/i, "");
}

function key(value: string | null | undefined) {
  return clean(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(public|community|consolidated|county|independent|school|schools|district)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchKde(): Promise<KdeRow[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(KDE_DIRECTORY, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; Pursuit-Raven/4.3; authoritative-public-directory)",
        accept: "text/html,application/xhtml+xml"
      }
    });
    if (!res.ok) throw new Error(`Kentucky KDE directory HTTP ${res.status}`);
    const $ = cheerio.load(await res.text());
    const rows: KdeRow[] = [];
    $("tr").each((_, element) => {
      const cells = $(element).find("th,td").map((__, cell) => clean($(cell).text())).get();
      if (cells.length < 5 || !/^\d{3,4}$/.test(cells[0] || "")) return;
      const district = clean(cells[1] || "");
      const fullName = stripHonorific(cells[2] || "");
      const phone = cells.find(cell => /\(?\d{3}\)?[^\d]*\d{3}[^\d]*\d{4}/.test(cell)) || "";
      if (!district || !fullName || !phone) return;
      rows.push({ district, fullName, phone });
    });
    const deduped = new Map<string, KdeRow>();
    for (const row of rows) deduped.set(key(row.district), row);
    return [...deduped.values()];
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req); if (auth) return auth;
  const sql = getSql();
  const beforeRows = await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[];

  let roster: KdeRow[] = [];
  try { roster = await fetchKde(); }
  catch (error) {
    console.error("RAVEN_KY_AUTHORITATIVE_FETCH", error);
    return NextResponse.json({ ok:false, blocker:error instanceof Error ? error.message : String(error), before:beforeRows[0] || null }, { status:502 });
  }

  const slots = await sql.query(`
    select c.id::text,c.county,a.canonical_name
    from raven_state_contacts c
    left join agencies a on a.id=c.agency_id
    where c.state_code='KY' and c.scope='district' and c.role_key='superintendent' and c.verification_status='missing'
    order by coalesce(c.updated_at,c.created_at) asc,c.id asc
    limit 80
  `) as MissingSlot[];

  const byKey = new Map(roster.map(row => [key(row.district), row]));
  let filled = 0;
  let unmatched = 0;
  const attemptedIds: string[] = [];

  for (const slot of slots) {
    attemptedIds.push(slot.id);
    const countyKey = key(slot.county);
    const agencyKey = key(slot.canonical_name);
    const row = byKey.get(agencyKey) || byKey.get(countyKey) || roster.find(r => {
      const rk = key(r.district);
      return !!rk && ((agencyKey && (agencyKey.includes(rk) || rk.includes(agencyKey))) || (countyKey && (countyKey.includes(rk) || rk.includes(countyKey))));
    });

    if (row) {
      const updated = await sql.query(`
        update raven_state_contacts
        set full_name=$2,title='Superintendent',phone=$3,email=null,source_url=$4,
            verification_status='candidate',
            evidence_note='Kentucky superintendent and phone published in the official KDE SDCI statewide district directory; awaiting strict live revalidation.',
            updated_at=now()
        where id=$1 and verification_status='missing'
        returning id
      `,[slot.id,row.fullName,row.phone,KDE_DIRECTORY]) as any[];
      filled += updated.length;
    } else {
      unmatched++;
      await sql.query(`
        update raven_state_contacts
        set evidence_note='Authoritative Kentucky KDE statewide directory checked; district identity did not match this slot on this pass.',updated_at=now()
        where id=$1 and verification_status='missing'
      `,[slot.id]);
    }
  }

  const afterRows = await sql.query(`select count(*)::int total,count(*) filter(where verification_status='verified')::int verified,count(*) filter(where verification_status='candidate')::int candidate,count(*) filter(where verification_status='missing')::int missing,count(*) filter(where verification_status='rejected')::int rejected from raven_state_contacts`) as any[];
  const summary = { ok:true, source:KDE_DIRECTORY, rosterFetched:roster.length, districtsNewlyAttempted:attemptedIds.length, filled, unmatched, before:beforeRows[0] || null, after:afterRows[0] || null };
  console.log("RAVEN_KY_AUTHORITATIVE", summary);
  return NextResponse.json(summary);
}
