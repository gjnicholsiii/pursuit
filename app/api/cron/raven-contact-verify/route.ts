import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FETCH_TIMEOUT_MS = 7_000;
const RUN_BUDGET_MS = 260_000;
const MAX_CANDIDATES = 240;
const CONCURRENCY = 24;

const BANNED = /\b(facilit(?:y|ies)|plant|maintenance|buildings?\s*(?:&|and)\s*grounds|procurement|purchasing|finance|financial|principal|teacher|operations?|transportation|food service|human resources|\bhr\b)\b/i;
const GENERIC_PERSON = /\b(find us|about us|important files|in this section|upcoming meetings|help ticket|acceptable use policy|get in touch|news announcements|horizontal nav|school district|county usd|district office|our schools|quick links|contact us|learn more|read more|staff directory|board of education)\b/i;
const GENERIC_TOKEN = /^(find|about|important|files?|section|upcoming|meetings?|help|ticket|acceptable|use|policy|get|touch|news|announcements?|horizontal|nav|district|county|school|schools|usd|office|quick|links?|contact|learn|read|more)$/i;
const HONORIFIC = /^(dr|mr|mrs|ms|miss|chief|rev|reverend)\.?$/i;
const SECURITY = /\b(?:director|chief|executive director|senior director|associate superintendent)\b.{0,80}\b(?:security|school safety|public safety|safety and security|security and safety|emergency management|safe schools)\b|\b(?:security|school safety|public safety|safety and security|security and safety|emergency management|safe schools)\b.{0,80}\b(?:director|chief|executive director|senior director|associate superintendent)\b/i;
const STRICT: Record<string, RegExp> = {
  state_security_director: SECURITY,
  security_director: SECURITY,
  superintendent: /^((?!assistant|deputy|associate).)*\bsuperintendent\b/i,
  assistant_superintendent: /\b(?:assistant|asst\.?)\s+superintendent\b/i,
  it_director: /\b(?:director|executive director|chief information officer|chief technology officer|cio|cto)\b.{0,60}\b(?:information technology|technology|information systems|it services|network services|tech infrastructure|cybersecurity)\b|\b(?:information technology|technology|information systems|it services|network services|tech infrastructure|cybersecurity)\b.{0,60}\b(?:director|chief information officer|chief technology officer|cio|cto)\b/i,
  school_board: /\b(?:school\s+|governing\s+)?board\s+(?:member|chair|chairman|chairwoman|president|vice president|trustee|clerk)\b|\bboard trustee\b/i,
};

function norm(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function plausiblePerson(v: string) {
  const raw = v.trim();
  if (raw.length < 5 || raw.length > 80 || GENERIC_PERSON.test(raw)) return false;
  const parts = raw.replace(/[,()]/g, " ").split(/\s+/).filter(Boolean);
  const meaningful = parts.filter((p) => !HONORIFIC.test(p));
  if (meaningful.length < 2 || meaningful.length > 5) return false;
  if (meaningful.some((p) => GENERIC_TOKEN.test(p))) return false;
  return meaningful.every((p) => /^[A-Za-z][A-Za-z.'-]*$/.test(p));
}
function host(v: string | null) {
  if (!v) return "";
  try {
    return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}
function relatedHost(a: string, b: string) {
  return !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
}
async function fetchText(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; Pursuit-Raven-Verifier/3.0; public-contact-verification)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
      },
    });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("html") && !type.includes("text")) return null;
    const body = await response.text();
    return { text: norm(cheerio.load(body)("body").text()), finalUrl: response.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;

  const started = Date.now();
  const sql = getSql();
  let verified = 0;
  let rejected = 0;
  let unchanged = 0;

  const falseVerified = (await sql.query(`
    update raven_state_contacts
    set verification_status='rejected', verified_at=null,
        evidence_note='Rejected: navigation, organization, or page label was misidentified as a person.',
        updated_at=now()
    where verification_status='verified'
      and (
        lower(coalesce(full_name,'')) in (
          'find us','about us','important files','in this section','upcoming meetings','help ticket',
          'acceptable use policy','get in touch','news announcements','horizontal nav','comanche county usd'
        )
        or lower(coalesce(full_name,'')) ~ '(school district|county usd|district office|staff directory|board of education)'
      )
    returning id
  `)) as any[];

  const removed = (await sql.query(`
    delete from raven_state_contacts m
    where m.verification_status='missing'
      and m.full_name is null
      and exists (
        select 1 from raven_state_contacts x
        where x.id<>m.id
          and x.state_code=m.state_code
          and regexp_replace(lower(coalesce(x.county,'')),'\\s+(county|municipality|city and borough|borough)$','')=
              regexp_replace(lower(coalesce(m.county,'')),'\\s+(county|municipality|city and borough|borough)$','')
          and x.scope=m.scope
          and x.role_key=m.role_key
          and x.verification_status in ('candidate','verified')
          and x.full_name is not null
      )
    returning id
  `)) as any[];

  const candidates = (await sql.query(`
    select c.id::text,c.state_code,c.role_key,c.full_name,c.title,c.source_url,a.website agency_website
    from raven_state_contacts c
    left join agencies a on a.id=c.agency_id
    where c.verification_status='candidate'
      and c.full_name is not null
      and c.title is not null
      and c.source_url is not null
    order by c.updated_at asc nulls first,c.state_code,c.id
    limit $1
  `, [MAX_CANDIDATES])) as any[];

  async function verify(row: any) {
    if (Date.now() - started > RUN_BUDGET_MS) return;
    const title = String(row.title || "");
    const fullName = String(row.full_name || "");
    const rule = STRICT[String(row.role_key)] || null;
    if (!plausiblePerson(fullName) || !rule || BANNED.test(title) || !rule.test(title)) {
      await sql.query(
        `update raven_state_contacts set verification_status='rejected',evidence_note=$2,updated_at=now() where id=$1 and verification_status='candidate'`,
        [row.id, !plausiblePerson(fullName) ? "Rejected by person-name verifier; candidate is a page label, organization label, or otherwise not a plausible individual." : "Rejected by strict outreach-role verifier; title is outside approved school-security contact roles."]
      );
      rejected++;
      return;
    }

    const sourceHost = host(String(row.source_url));
    const agencyHost = host(row.agency_website ? String(row.agency_website) : null);
    if (agencyHost && !relatedHost(sourceHost, agencyHost)) {
      unchanged++;
      return;
    }

    const page = await fetchText(String(row.source_url));
    if (!page) {
      unchanged++;
      return;
    }
    const finalHost = host(page.finalUrl);
    if (agencyHost && !relatedHost(finalHost, agencyHost)) {
      unchanged++;
      return;
    }

    const person = norm(fullName);
    const normalizedTitle = norm(title);
    const nameOk = person.length >= 5 && page.text.includes(person);
    const titleOk = normalizedTitle.length >= 4 && page.text.includes(normalizedTitle);
    if (nameOk && titleOk) {
      await sql.query(
        `update raven_state_contacts set verification_status='verified',verified_at=now(),evidence_note='Live official organization page revalidated: exact plausible person and title present.',updated_at=now() where id=$1 and verification_status='candidate'`,
        [row.id]
      );
      verified++;
    } else {
      unchanged++;
    }
  }

  for (let i = 0; i < candidates.length && Date.now() - started <= RUN_BUDGET_MS; i += CONCURRENCY) {
    await Promise.all(candidates.slice(i, i + CONCURRENCY).map(verify));
  }

  const counts = (await sql.query(`
    select
      count(*)::int total,
      count(*) filter(where verification_status='verified')::int verified,
      count(*) filter(where verification_status='candidate')::int candidate,
      count(*) filter(where verification_status='missing')::int missing,
      count(*) filter(where verification_status='rejected')::int rejected,
      count(distinct state_code)::int states
    from raven_state_contacts
  `)) as any[];

  return NextResponse.json({
    ok: true,
    mode: "bulk-only-strict-person-gate",
    examined: candidates.length,
    verifiedThisRun: verified,
    rejectedThisRun: rejected,
    falseVerifiedRemoved: falseVerified.length,
    unchangedThisRun: unchanged,
    duplicateMissingRemoved: removed.length,
    elapsedMs: Date.now() - started,
    totals: counts[0] || null,
  });
}
