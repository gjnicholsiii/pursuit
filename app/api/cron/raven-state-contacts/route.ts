import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { extractText, getDocumentProxy } from "unpdf";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const AL_DIRECTORY = "https://www.alabamaachieves.org/wp-content/uploads/2025/01/COMM_20250106_DAPS-2025_V1.0.pdf";
const EXCLUDED = /facilit|plant|maintenance|buildings?\s*(?:&|and)\s*grounds|procurement|purchasing|finance|financial|principal|teacher|generic operations|operations director/i;

type RoleKey = "state_security_director" | "security_director" | "school_board" | "superintendent" | "assistant_superintendent" | "it_director";

type Agency = { id: string; canonical_name: string; county: string | null; website: string | null };

type FoundContact = {
  roleKey: RoleKey;
  fullName: string;
  title: string;
  email: string | null;
  phone: string | null;
  sourceUrl: string;
};

function norm(s: string) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanLine(s: string) {
  return s.replace(/[•☆★]/g, " ").replace(/\s+/g, " ").trim();
}

function roleFromTitle(title: string): RoleKey | null {
  const t = cleanLine(title);
  if (!t || EXCLUDED.test(t)) return null;
  if (/^(superintendent|district superintendent|county superintendent)$/i.test(t)) return "superintendent";
  if (/^(assistant|asst\.?|deputy|associate) superintendent\b/i.test(t)) return "assistant_superintendent";
  if (/^(chief information officer|chief technology officer|cio|cto)$/i.test(t)) return "it_director";
  if (/^(director|executive director|chief|administrator)\b.*\b(information technology|technology services|technology|information systems|it services)\b/i.test(t)) return "it_director";
  if (/\b(information technology|technology services|information systems)\b.*\b(director|executive director|chief|administrator)\b/i.test(t)) return "it_director";
  if (/^(director|executive director|chief|coordinator|administrator|supervisor)\b.*\b(school safety|safety and security|security|public safety)\b/i.test(t)) return "security_director";
  if (/\b(school safety|safety and security|public safety|security)\b.*\b(director|executive director|chief|coordinator|administrator|supervisor)\b/i.test(t)) return "security_director";
  if (/^(board member|board chair|board chairman|board chairperson|board president|board vice president|board trustee|school board member)$/i.test(t)) return "school_board";
  return null;
}

function plausibleName(s: string) {
  const x = cleanLine(s).replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i, "").trim();
  if (x.length < 4 || x.length > 90) return false;
  const words = x.split(/\s+/);
  return words.length >= 2 && words.length <= 7 && words.every(w => /^[A-Za-z][A-Za-z.'-]*$/.test(w));
}

function emailFrom($el: cheerio.Cheerio<any>, text: string) {
  const href = $el.find('a[href^="mailto:"]').first().attr("href");
  if (href) return href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

function phoneFrom($el: cheerio.Cheerio<any>, text: string) {
  const href = $el.find('a[href^="tel:"]').first().attr("href");
  if (href) return href.replace(/^tel:/i, "").trim();
  const m = text.match(/(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d+)?/i);
  return m ? m[0].trim() : null;
}

function contactsFromHtml(html: string, url: string): FoundContact[] {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg").remove();
  const out: FoundContact[] = [];
  const selectors = "tr, li, article, section, .staff, .staff-member, .person, .person-card, .card, .contact, .employee, .directory-item";
  $(selectors).each((_, el) => {
    const $el = $(el);
    const text = cleanLine($el.text());
    if (!text || text.length > 700 || EXCLUDED.test(text)) return;
    const roleMatchers: Array<[RoleKey, RegExp]> = [
      ["superintendent", /\b(superintendent|district superintendent|county superintendent)\b/i],
      ["assistant_superintendent", /\b(assistant|asst\.?|deputy|associate) superintendent\b/i],
      ["it_director", /\b(chief information officer|chief technology officer|cio|cto|director of (?:information technology|technology|technology services|information systems)|(?:information technology|technology services|information systems) director)\b/i],
      ["security_director", /\b(director|executive director|chief|coordinator|administrator|supervisor)\b.{0,80}\b(school safety|safety and security|security|public safety)\b|\b(school safety|safety and security|security|public safety)\b.{0,80}\b(director|executive director|chief|coordinator|administrator|supervisor)\b/i],
      ["school_board", /\b(board member|board chair|board chairman|board chairperson|board president|board vice president|board trustee|school board member)\b/i],
    ];
    for (const [roleKey, re] of roleMatchers) {
      const match = text.match(re);
      if (!match) continue;
      const title = cleanLine(match[0]);
      if (roleFromTitle(title) !== roleKey && roleKey !== "school_board") continue;
      const candidates = $el.find("h1,h2,h3,h4,h5,strong,b,.name,.staff-name,.person-name").map((__, n) => cleanLine($(n).text())).get();
      let fullName = candidates.find(plausibleName) || "";
      if (!fullName) {
        const before = cleanLine(text.slice(0, match.index || 0)).split(/\s{2,}|\||•/).pop() || "";
        if (plausibleName(before)) fullName = before;
      }
      if (!fullName) continue;
      out.push({ roleKey, fullName, title, email: emailFrom($el, text), phone: phoneFrom($el, text), sourceUrl: url });
      break;
    }
  });
  return out;
}

function candidatePages(baseUrl: string, html: string) {
  const base = new URL(baseUrl);
  const $ = cheerio.load(html);
  const urls = new Set<string>([baseUrl]);
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const label = `${$(el).text()} ${href}`;
    if (!/(staff|directory|administr|leadership|superintendent|board|technology|information.?technology|security|school.?safety|public.?safety|contact)/i.test(label)) return;
    try {
      const u = new URL(href, base);
      if (u.hostname === base.hostname && /^https?:$/.test(u.protocol)) {
        u.hash = "";
        urls.add(u.toString());
      }
    } catch {}
  });
  return [...urls].slice(0, 12);
}

async function fetchHtml(url: string) {
  const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 RavenContactVerifier/1.0" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const type = r.headers.get("content-type") || "";
  if (!type.includes("text/html")) throw new Error("not html");
  return await r.text();
}

async function ensureTables(sql: ReturnType<typeof getSql>) {
  await sql.query(`create table if not exists raven_contact_scan_state(agency_id bigint primary key references agencies(id) on delete cascade,state_code text not null,last_scanned_at timestamptz,last_error text,pages_scanned int not null default 0,verified_found int not null default 0)`);
  await sql.query(`create table if not exists raven_state_builds(state_code text primary key,directory_imported_at timestamptz,last_run_at timestamptz,notes text)`);
}

async function upsertContact(sql: ReturnType<typeof getSql>, agency: Agency | null, stateCode: string, county: string | null, scope: "state" | "county" | "district", found: FoundContact, status: "candidate" | "verified", note: string) {
  if (agency) {
    const exact = await sql.query(`select id from raven_state_contacts where state_code=$1 and agency_id=$2 and role_key=$3 and lower(coalesce(full_name,''))=lower($4) limit 1`, [stateCode, agency.id, found.roleKey, found.fullName]) as any[];
    if (exact[0]?.id) {
      await sql.query(`update raven_state_contacts set county=$2,scope=$3,title=$4,email=coalesce($5,email),phone=coalesce($6,phone),source_url=$7,verification_status=$8,verified_at=case when $8='verified' then now() else verified_at end,evidence_note=$9,updated_at=now() where id=$1`, [exact[0].id, county, scope, found.title, found.email, found.phone, found.sourceUrl, status, note]);
      return;
    }
    const blank = await sql.query(`select id from raven_state_contacts where state_code=$1 and agency_id=$2 and role_key=$3 and (full_name is null or btrim(full_name)='') order by id limit 1`, [stateCode, agency.id, found.roleKey]) as any[];
    if (blank[0]?.id) {
      await sql.query(`update raven_state_contacts set county=$2,scope=$3,full_name=$4,title=$5,email=$6,phone=$7,source_url=$8,verification_status=$9,verified_at=case when $9='verified' then now() else null end,evidence_note=$10,updated_at=now() where id=$1`, [blank[0].id, county, scope, found.fullName, found.title, found.email, found.phone, found.sourceUrl, status, note]);
      return;
    }
  }
  await sql.query(`insert into raven_state_contacts(state_code,county,agency_id,scope,role_key,full_name,title,email,phone,source_url,verification_status,verified_at,evidence_note) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,case when $11='verified' then now() else null end,$12) on conflict do nothing`, [stateCode, county, agency?.id || null, scope, found.roleKey, found.fullName, found.title, found.email, found.phone, found.sourceUrl, status, note]);
}

function parseDirectorySection(section: string, sourceUrl: string) {
  const found: FoundContact[] = [];
  const lines = section.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const boardStart = lines.findIndex(x => /^BOARD OF EDUCATION$/i.test(x));
  const supStart = lines.findIndex(x => /^SUPERINTENDENT['’]S OFFICE$/i.test(x));
  const programStart = lines.findIndex((x, i) => i > supStart && /^PROGRAM KEY CONTACTS$/i.test(x));
  if (boardStart >= 0 && supStart > boardStart) {
    for (const line of lines.slice(boardStart + 1, supStart)) {
      const m = line.match(/^(.+?)\s+(Chairman|Chairperson|President|Vice President|Board Member|Trustee)$/i);
      if (!m || !plausibleName(m[1])) continue;
      found.push({ roleKey: "school_board", fullName: cleanLine(m[1]), title: cleanLine(m[2]), email: null, phone: phoneFrom(cheerio.load("<div></div>")("div"), line), sourceUrl });
    }
  }
  if (supStart >= 0) {
    const end = programStart > supStart ? programStart : Math.min(lines.length, supStart + 40);
    for (const line of lines.slice(supStart + 1, end)) {
      const m = line.match(/^(.+?)\s+(Superintendent|Asst Superintendent|Assistant Superintendent|Deputy Superintendent)(?:\s+(.+))?$/i);
      if (!m || !plausibleName(m[1])) continue;
      const roleKey: RoleKey = /^(asst|assistant|deputy)/i.test(m[2]) ? "assistant_superintendent" : "superintendent";
      found.push({ roleKey, fullName: cleanLine(m[1]), title: cleanLine(m[2]), email: null, phone: phoneFrom(cheerio.load("<div></div>")("div"), m[3] || line), sourceUrl });
    }
  }
  return found;
}

async function importAlabamaDirectory(sql: ReturnType<typeof getSql>) {
  const done = await sql.query(`select directory_imported_at from raven_state_builds where state_code='AL'`) as any[];
  if (done[0]?.directory_imported_at) return { imported: false, candidates: 0 };

  const resp = await fetch(AL_DIRECTORY, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`ALSDE directory HTTP ${resp.status}`);
  const pdf = await getDocumentProxy(new Uint8Array(await resp.arrayBuffer()));
  const extracted = await extractText(pdf, { mergePages: true });
  const text = typeof extracted.text === "string" ? extracted.text : extracted.text.join("\n");
  const agencies = await sql.query(`select id::text,canonical_name,county,website from agencies where agency_type='k12' and state_code='AL'`) as Agency[];
  const byName = new Map(agencies.map(a => [norm(a.canonical_name), a]));
  const headers = [...text.matchAll(/(?:^|\n)\s*\d{3}\s*[☆★]\s*([^\n]+? County)\s*(?=\n)/g)];
  let candidates = 0;
  for (let i = 0; i < headers.length; i++) {
    const countyName = cleanLine(headers[i][1]);
    const start = (headers[i].index || 0) + headers[i][0].length;
    const end = i + 1 < headers.length ? (headers[i + 1].index || text.length) : text.length;
    const agency = byName.get(norm(countyName)) || agencies.find(a => norm(a.canonical_name).includes(norm(countyName)));
    if (!agency) continue;
    const section = text.slice(start, end);
    const found = parseDirectorySection(section, AL_DIRECTORY);
    for (const c of found) {
      await upsertContact(sql, agency, "AL", agency.county || countyName.replace(/ County$/i, ""), "district", c, "candidate", "Official ALSDE Directory of Alabama Public Schools 2025; current district-site verification still required.");
      candidates++;
    }
  }

  const stateSafety: FoundContact = {
    roleKey: "state_security_director",
    fullName: "Shaundalyn Elliott",
    title: "Education Specialist - School Safety Section",
    email: "selliott@alsde.edu",
    phone: "334-694-4717",
    sourceUrl: AL_DIRECTORY,
  };
  await upsertContact(sql, null, "AL", null, "state", stateSafety, "candidate", "ALSDE 2025 directory places Elliott in the School Safety section; email/phone also published by ALSDE. Current-title recheck required before outreach.");

  await sql.query(`insert into raven_state_builds(state_code,directory_imported_at,last_run_at,notes) values('AL',now(),now(),$1) on conflict(state_code) do update set directory_imported_at=excluded.directory_imported_at,last_run_at=excluded.last_run_at,notes=excluded.notes`, [`Imported ${candidates} ALSDE directory candidates`]);
  return { imported: true, candidates };
}

async function verifyAgency(sql: ReturnType<typeof getSql>, agency: Agency) {
  if (!agency.website) return { pages: 0, verified: 0, error: "no website" };
  let base = agency.website;
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  try {
    const home = await fetchHtml(base);
    const pages = candidatePages(base, home);
    let verified = 0;
    let scanned = 0;
    const seen = new Set<string>();
    for (const url of pages) {
      try {
        const html = url === base ? home : await fetchHtml(url);
        scanned++;
        for (const c of contactsFromHtml(html, url)) {
          const key = `${c.roleKey}|${norm(c.fullName)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          await upsertContact(sql, agency, "AL", agency.county, "district", c, "verified", "Verified on current official district website with exact role/person evidence.");
          verified++;
        }
      } catch {}
    }
    await sql.query(`insert into raven_contact_scan_state(agency_id,state_code,last_scanned_at,last_error,pages_scanned,verified_found) values($1,'AL',now(),null,$2,$3) on conflict(agency_id) do update set last_scanned_at=now(),last_error=null,pages_scanned=$2,verified_found=$3`, [agency.id, scanned, verified]);
    return { pages: scanned, verified, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sql.query(`insert into raven_contact_scan_state(agency_id,state_code,last_scanned_at,last_error,pages_scanned,verified_found) values($1,'AL',now(),$2,0,0) on conflict(agency_id) do update set last_scanned_at=now(),last_error=$2`, [agency.id, msg]);
    return { pages: 0, verified: 0, error: msg };
  }
}

export async function GET(req: NextRequest) {
  const auth = requireInternalAuth(req);
  if (auth) return auth;
  const sql = getSql();
  await ensureTables(sql);
  const imported = await importAlabamaDirectory(sql);

  const agencies = await sql.query(`
    select a.id::text,a.canonical_name,a.county,a.website
    from agencies a
    left join raven_contact_scan_state s on s.agency_id=a.id
    where a.agency_type='k12' and a.state_code='AL'
      and a.county is not null and btrim(a.county)<>''
      and (a.jurisdiction_level='county' or a.canonical_name ilike '%County%')
    order by s.last_scanned_at asc nulls first,a.canonical_name
    limit 3
  `) as Agency[];

  const scans = [];
  for (const agency of agencies) scans.push({ agency: agency.canonical_name, ...(await verifyAgency(sql, agency)) });
  await sql.query(`insert into raven_state_builds(state_code,last_run_at,notes) values('AL',now(),$1) on conflict(state_code) do update set last_run_at=now(),notes=$1`, [`Scanned ${scans.length} Alabama county systems this run`]);

  const counts = await sql.query(`select verification_status,count(*)::int n from raven_state_contacts where state_code='AL' group by verification_status order by verification_status`) as any[];
  const roleCounts = await sql.query(`select role_key,verification_status,count(*)::int n from raven_state_contacts where state_code='AL' group by role_key,verification_status order by role_key,verification_status`) as any[];
  console.log("RAVEN_STATE_CONTACT_RUN", JSON.stringify({ state: "AL", imported, scans, counts, roleCounts }));
  return NextResponse.json({ ok: true, state: "AL", imported, scans, counts, roleCounts });
}
