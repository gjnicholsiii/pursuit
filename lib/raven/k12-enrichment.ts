import { getSql } from "@/lib/db";

type Agency = { id: string; canonical_name: string; website: string };
type Candidate = { name: string; title: string; roleFamily: string; email?: string; phone?: string; sourceUrl: string; confidence: number };

const ROLE_RULES: Array<{ family: string; terms: RegExp }> = [
  { family: "Technology", terms: /\b(cio|cto|chief technology|chief information|director of technology|technology director|director of information technology|it director|information technology director)\b/i },
  { family: "Security", terms: /\b(director of (?:safety|security)|safety director|security director|school safety|chief of security|public safety)\b/i },
  { family: "Facilities", terms: /\b(facilities director|director of facilities|operations director|director of operations|chief operations officer|coo)\b/i },
  { family: "Executive", terms: /\b(superintendent|deputy superintendent|assistant superintendent)\b/i },
  { family: "Procurement", terms: /\b(procurement|purchasing|director of finance|chief financial officer|cfo)\b/i },
  { family: "Board", terms: /\b(board president|board vice president|board member|school board)\b/i },
];

const LINK_TERMS = /staff|directory|administration|leadership|technology|information.?technology|security|safety|facilities|operations|procurement|purchasing|board/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;

function safePublicUrl(raw: string) {
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return null;
    return url;
  } catch { return null; }
}

function absoluteSameHost(base: URL, href: string) {
  try {
    const u = new URL(href, base);
    return u.hostname === base.hostname && /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch { return null; }
}

function decode(text: string) {
  return text.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;/g, "'").replace(/&quot;/gi, '"').replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function visibleText(html: string) {
  return decode(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n");
}

function titleCaseName(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/(^|\s)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

function plausibleName(value: string) {
  const s = value.replace(/[^A-Za-z.' -]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length < 5 || s.length > 60) return null;
  const parts = s.split(" ").filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return null;
  if (/director|superintendent|technology|security|facilities|board|department|school|district|office/i.test(s)) return null;
  return titleCaseName(s);
}

function extractCandidates(html: string, sourceUrl: string): Candidate[] {
  const lines = visibleText(html).split("\n").map(x => x.trim()).filter(Boolean);
  const candidates: Candidate[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rule = ROLE_RULES.find(r => r.terms.test(line));
    if (!rule) continue;
    const context = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 4));
    const title = line.length <= 120 ? line : line.slice(0, 120);
    const joined = context.join(" ");
    const email = joined.match(EMAIL_RE)?.[0];
    const phone = joined.match(PHONE_RE)?.[0];
    let name: string | null = null;
    for (const offset of [-1, 1, -2, 2]) {
      const candidateLine = lines[i + offset];
      if (!candidateLine) continue;
      name = plausibleName(candidateLine.replace(EMAIL_RE, "").replace(PHONE_RE, ""));
      if (name) break;
    }
    if (!name && email) name = plausibleName(email.split("@")[0].replace(/[._-]+/g, " "));
    if (!name) continue;
    candidates.push({ name, title, roleFamily: rule.family, email, phone, sourceUrl, confidence: email ? 88 : phone ? 82 : 72 });
  }
  const deduped = new Map<string, Candidate>();
  for (const c of candidates) {
    const key = `${c.name}|${c.title}`.toLowerCase();
    const old = deduped.get(key);
    if (!old || c.confidence > old.confidence) deduped.set(key, c);
  }
  return [...deduped.values()].slice(0, 20);
}

async function fetchPage(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { "user-agent": "Pursuit-Raven/1.0 (+public-business-intelligence)" } });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html")) return null;
    return { html: await res.text(), finalUrl: res.url || url };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function discoverOfficialSite(seed: URL, html: string) {
  if (!seed.hostname.endsWith("nces.ed.gov")) return seed;
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  const candidates: URL[] = [];
  while ((match = re.exec(html))) {
    const label = visibleText(match[2]).trim();
    try {
      const u = new URL(match[1], seed);
      if (!/^https?:$/.test(u.protocol)) continue;
      if (u.hostname.endsWith("ed.gov") || u.hostname.endsWith("usa.gov")) continue;
      if (/web\s*site|website|district|school/i.test(label)) candidates.push(u);
    } catch {}
  }
  return candidates[0] || seed;
}

function discoverLinks(base: URL, html: string) {
  const links: string[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const label = visibleText(match[2]);
    const href = match[1];
    if (!LINK_TERMS.test(`${label} ${href}`)) continue;
    const u = absoluteSameHost(base, href);
    if (u) links.push(u);
  }
  return [...new Set(links)].slice(0, 6);
}

async function enrichAgency(agency: Agency) {
  const sql = getSql();
  const seed = safePublicUrl(agency.website);
  if (!seed) return { agency: agency.canonical_name, ok: false, reason: "invalid website", pages: 0, people: 0 };

  const runRows = await sql.query(`insert into raven_enrichment_runs (agency_id, status) values ($1, 'running') returning id::text`, [agency.id]);
  const runId = String(runRows[0]?.id || "");
  let pages = 0;
  let people = 0;
  const errors: string[] = [];

  try {
    const seedPage = await fetchPage(seed.toString());
    if (!seedPage) throw new Error("seed page unavailable");
    pages++;
    let base = discoverOfficialSite(seed, seedPage.html);
    let homepage = seedPage.html;

    if (base.hostname !== seed.hostname) {
      const officialPage = await fetchPage(base.toString());
      if (!officialPage) throw new Error("official district site unavailable");
      pages++;
      base = safePublicUrl(officialPage.finalUrl) || base;
      homepage = officialPage.html;
      await sql.query(`update agencies set website=$2 where id=$1`, [agency.id, base.toString()]);
    }

    const urls = [base.toString(), ...discoverLinks(base, homepage)].slice(0, 5);
    const allCandidates: Candidate[] = extractCandidates(homepage, base.toString());
    for (const url of urls.slice(1)) {
      const page = await fetchPage(url);
      if (!page) { errors.push(url); continue; }
      pages++;
      allCandidates.push(...extractCandidates(page.html, page.finalUrl));
    }

    const unique = new Map<string, Candidate>();
    for (const c of allCandidates) unique.set(`${c.name}|${c.title}`.toLowerCase(), c);
    for (const c of [...unique.values()].slice(0, 20)) {
      await sql.query(`
        insert into raven_people (agency_id, full_name, title, role_family, email, phone, source_url, source_type, confidence, last_verified_at, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,'public_web',$8,now(),now())
        on conflict (agency_id, full_name, title) do update set
          role_family=excluded.role_family,
          email=coalesce(excluded.email, raven_people.email),
          phone=coalesce(excluded.phone, raven_people.phone),
          source_url=excluded.source_url,
          confidence=greatest(raven_people.confidence, excluded.confidence),
          last_verified_at=now(), updated_at=now()
      `, [agency.id, c.name, c.title, c.roleFamily, c.email || null, c.phone || null, c.sourceUrl, c.confidence]);
      people++;
    }

    await sql.query(`update raven_enrichment_runs set status='complete', pages_scanned=$2, people_found=$3, completed_at=now(), diagnostics=$4::jsonb where id=$1`, [runId, pages, people, JSON.stringify({ errors, officialWebsite: base.toString() })]);
    return { agency: agency.canonical_name, ok: true, pages, people, website: base.toString() };
  } catch (error) {
    await sql.query(`update raven_enrichment_runs set status='failed', pages_scanned=$2, people_found=$3, completed_at=now(), diagnostics=$4::jsonb where id=$1`, [runId, pages, people, JSON.stringify({ error: error instanceof Error ? error.message : String(error), errors })]);
    return { agency: agency.canonical_name, ok: false, pages, people, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function enrichK12Batch(limit = 10) {
  const sql = getSql();
  const rows = await sql.query(`
    select a.id::text, a.canonical_name, a.website
    from agencies a
    where a.agency_type='k12'
      and a.website is not null and a.website <> ''
      and not exists (
        select 1 from raven_enrichment_runs r
        where r.agency_id=a.id and r.status='complete' and r.completed_at > now() - interval '30 days'
      )
    order by coalesce((select max(r.completed_at) from raven_enrichment_runs r where r.agency_id=a.id), '1970-01-01'::timestamptz), a.canonical_name
    limit $1
  `, [Math.max(1, Math.min(limit, 25))]);

  const agencies = rows as unknown as Agency[];
  const results = [];
  for (const agency of agencies) results.push(await enrichAgency(agency));
  return { attempted: agencies.length, results, peopleFound: results.reduce((sum, r) => sum + r.people, 0), pagesScanned: results.reduce((sum, r) => sum + r.pages, 0) };
}
