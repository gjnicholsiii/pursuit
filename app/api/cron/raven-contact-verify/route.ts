import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BANNED = /\b(facilit(?:y|ies)|plant|maintenance|buildings?\s*(?:&|and)\s*grounds|procurement|purchasing|finance|financial|principal|teacher|operations?)\b/i;
const STRICT: Record<string, RegExp> = {
  security_director: /\b(?:director|chief|executive director)\b.{0,60}\b(?:security|school safety|public safety|safety and security|security and safety)\b|\b(?:security|school safety|public safety|safety and security|security and safety)\b.{0,60}\b(?:director|chief|executive director)\b/i,
  superintendent: /\bsuperintendent\b/i,
  assistant_superintendent: /\b(?:assistant|asst\.?)\s+superintendent\b/i,
  it_director: /\b(?:director|executive director)\b.{0,60}\b(?:information technology|technology|information systems|it services)\b|\b(?:information technology|technology|information systems|it services)\b.{0,60}\bdirector\b/i,
  school_board: /\b(?:school\s+)?board\s+(?:member|chair|chairman|chairwoman|president|vice president|trustee)\b|\bboard trustee\b/i,
};

function norm(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function host(v: string | null) {
  if (!v) return "";
  try { return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
function relatedHost(a: string, b: string) {
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}
async function fetchText(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(url, { redirect: "follow", cache: "no-store", signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; Pursuit-Raven-Verifier/1.0; public-contact-verification)", accept: "text/html,application/xhtml+xml" } });
    if (!r.ok) return null;
    const type = (r.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("html") && !type.includes("text")) return null;
    const html = await r.text();
    return { text: norm(cheerio.load(html)("body").text()), finalUrl: r.url || url };
  } catch { return null; } finally { clearTimeout(timer); }
}

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();

  // Remove stale blank placeholders once a real candidate/verified record exists for the same slot.
  const removed = await sql.query(`
    delete from raven_state_contacts m
    where m.verification_status='missing'
      and m.full_name is null
      and exists (
        select 1 from raven_state_contacts x
        where x.id<>m.id and x.state_code=m.state_code
          and coalesce(x.county,'')=coalesce(m.county,'')
          and coalesce(x.agency_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(m.agency_id,'00000000-0000-0000-0000-000000000000'::uuid)
          and x.scope=m.scope and x.role_key=m.role_key
          and x.verification_status in ('candidate','verified')
          and x.full_name is not null
      )
    returning id
  `) as any[];

  // Work alphabetically, but only on the first state that still has review work.
  const stateRows = await sql.query(`
    select state_code
    from raven_state_contacts
    group by state_code
    having count(*) filter(where verification_status in ('missing','candidate')) > 0
    order by state_code
    limit 1
  `) as any[];
  const state = String(stateRows[0]?.state_code || "");
  if (!state) return NextResponse.json({ ok: true, complete: true, placeholdersRemoved: removed.length });

  const candidates = await sql.query(`
    select c.id::text,c.role_key,c.full_name,c.title,c.source_url,a.website agency_website
    from raven_state_contacts c
    left join agencies a on a.id=c.agency_id
    where c.state_code=$1 and c.verification_status='candidate'
      and c.full_name is not null and c.title is not null and c.source_url is not null
    order by c.updated_at asc,c.id
    limit 12
  `, [state]) as any[];

  let verified = 0, rejected = 0, unchanged = 0;
  for (const row of candidates) {
    const title = String(row.title || "");
    const rule = STRICT[String(row.role_key)] || null;
    if (!rule || BANNED.test(title) || !rule.test(title)) {
      await sql.query(`update raven_state_contacts set verification_status='rejected',evidence_note=$2,updated_at=now() where id=$1`, [row.id, "Rejected by strict outreach-role verifier; title is outside approved school-security contact roles."]);
      rejected++; continue;
    }
    const sourceHost = host(String(row.source_url));
    const agencyHost = host(row.agency_website ? String(row.agency_website) : null);
    if (agencyHost && !relatedHost(sourceHost, agencyHost)) { unchanged++; continue; }
    const page = await fetchText(String(row.source_url));
    if (!page) { unchanged++; continue; }
    const finalHost = host(page.finalUrl);
    if (agencyHost && !relatedHost(finalHost, agencyHost)) { unchanged++; continue; }
    const nameNeedle = norm(String(row.full_name));
    const titleNeedle = norm(title);
    const nameOk = nameNeedle.length >= 5 && page.text.includes(nameNeedle);
    const titleOk = titleNeedle.length >= 4 && page.text.includes(titleNeedle);
    if (nameOk && titleOk) {
      await sql.query(`update raven_state_contacts set verification_status='verified',verified_at=now(),evidence_note='Live official organization page revalidated: exact person and title present.',updated_at=now() where id=$1`, [row.id]);
      verified++;
    } else unchanged++;
  }

  const counts = await sql.query(`
    select count(*)::int total,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidate,
      count(*) filter(where verification_status='missing')::int missing,
      count(*) filter(where verification_status='rejected')::int rejected
    from raven_state_contacts where state_code=$1
  `, [state]) as any[];
  const snapshot = { state, ...counts[0], verifiedThisRun: verified, rejectedThisRun: rejected, unchangedThisRun: unchanged, placeholdersRemoved: removed.length };
  console.log("RAVEN_CONTACT_VERIFY", JSON.stringify(snapshot));
  return NextResponse.json({ ok: true, ...snapshot });
}
