import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";
import { discoverIonWavePortal, IONWAVE_SOURCE, type IonWavePortal } from "@/lib/sled/ionwave";
import { persistSledOpportunities } from "@/lib/sled/persistence";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Agency = {
  id: string;
  canonical_name: string;
  state_code: string | null;
  city: string | null;
  county: string | null;
  website: string;
};

type PortalHit = {
  agency: Agency;
  platform: string;
  url: string;
};

const PLATFORM_RE = /(ionwave\.net|procurement\.opengov\.com|opengov\.com|bonfirehub\.com|bidnetdirect\.com|publicpurchase\.com|vendorregistry\.com|planetbids\.com|jaggaer\.com|bidsync\.com|periscopeholdings\.com)/i;
const INTERNAL_PROCUREMENT_RE = /procurement|purchasing|bids?|rfps?|solicitations?|vendors?|business[- ]services/i;

function safeUrl(raw: string, base?: string) {
  try {
    const u = new URL(raw, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return null;
    return u;
  } catch {
    return null;
  }
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; Pursuit-K12-Procurement-Discovery/1.0)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("html")) return null;
    return { html: await response.text(), finalUrl: response.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractPortalHits(html: string, pageUrl: string, agency: Agency) {
  const $ = cheerio.load(html);
  const hits: PortalHit[] = [];
  const internal: string[] = [];
  const base = safeUrl(pageUrl);
  if (!base) return { hits, internal };

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const label = $(el).text().replace(/\s+/g, " ").trim();
    const u = safeUrl(href, base.toString());
    if (!u) return;
    const haystack = `${label} ${u.pathname} ${u.hostname}`;
    if (PLATFORM_RE.test(u.hostname)) {
      let platform = "other";
      if (/ionwave\.net$/i.test(u.hostname)) platform = "ionwave";
      else if (/opengov/i.test(u.hostname)) platform = "opengov";
      else if (/bonfirehub/i.test(u.hostname)) platform = "bonfire";
      else if (/bidnetdirect/i.test(u.hostname)) platform = "bidnet";
      else if (/publicpurchase/i.test(u.hostname)) platform = "publicpurchase";
      else if (/vendorregistry/i.test(u.hostname)) platform = "vendorregistry";
      else if (/planetbids/i.test(u.hostname)) platform = "planetbids";
      else if (/jaggaer/i.test(u.hostname)) platform = "jaggaer";
      else if (/bidsync|periscopeholdings/i.test(u.hostname)) platform = "periscope";
      hits.push({ agency, platform, url: u.toString() });
      return;
    }
    if (u.hostname === base.hostname && INTERNAL_PROCUREMENT_RE.test(haystack)) {
      u.hash = "";
      internal.push(u.toString());
    }
  });

  return {
    hits,
    internal: [...new Set(internal)].slice(0, 2),
  };
}

async function scanAgency(agency: Agency) {
  const seed = safeUrl(agency.website);
  if (!seed) return { agency, pages: 0, hits: [] as PortalHit[] };
  const first = await fetchHtml(seed.toString());
  if (!first) return { agency, pages: 0, hits: [] as PortalHit[] };

  let pages = 1;
  const firstResult = extractPortalHits(first.html, first.finalUrl, agency);
  const hits = [...firstResult.hits];

  for (const url of firstResult.internal) {
    const page = await fetchHtml(url);
    if (!page) continue;
    pages++;
    hits.push(...extractPortalHits(page.html, page.finalUrl, agency).hits);
  }

  const unique = new Map<string, PortalHit>();
  for (const hit of hits) {
    const u = safeUrl(hit.url);
    if (!u) continue;
    unique.set(`${hit.platform}|${u.hostname}`, hit);
  }
  return { agency, pages, hits: [...unique.values()] };
}

function ionWavePortalFromHit(hit: PortalHit): IonWavePortal | null {
  const u = safeUrl(hit.url);
  if (!u || !/ionwave\.net$/i.test(u.hostname) || !hit.agency.state_code) return null;
  return {
    key: `${u.hostname.replace(/\.ionwave\.net$/i, "").replace(/[^a-z0-9]+/gi, "_")}_${hit.agency.state_code.toLowerCase()}`,
    agencyName: hit.agency.canonical_name,
    baseUrl: `${u.protocol}//${u.hostname}`,
    stateCode: hit.agency.state_code.trim(),
    city: hit.agency.city || undefined,
    county: hit.agency.county || undefined,
  };
}

export async function GET(request: NextRequest) {
  const auth = requireInternalAuth(request);
  if (auth) return auth;

  const sql = getSql();
  const shardCount = 200;
  const shard = Math.floor(Date.now() / 60000) % shardCount;
  const rows = await sql.query(
    `select id::text, canonical_name, state_code::text, city, county, website
     from agencies
     where agency_type='k12'
       and website is not null and website<>''
       and mod(abs(hashtextextended(id::text,0)), $1::bigint)=$2::bigint
     order by canonical_name`,
    [shardCount, shard],
  ) as Agency[];

  const scanned: Awaited<ReturnType<typeof scanAgency>>[] = [];
  for (let i = 0; i < rows.length; i += 12) {
    scanned.push(...await Promise.all(rows.slice(i, i + 12).map(scanAgency)));
  }

  const hits = scanned.flatMap(r => r.hits);
  const ionwave = [...new Map(
    hits.filter(h => h.platform === "ionwave")
      .map(ionWavePortalFromHit)
      .filter((p): p is IonWavePortal => Boolean(p))
      .map(p => [p.baseUrl, p]),
  ).values()];

  let ionwaveStored = 0;
  const ionwaveDiagnostics: Array<Record<string, unknown>> = [];
  for (let i = 0; i < ionwave.length; i += 4) {
    const batch = ionwave.slice(i, i + 4);
    const results = await Promise.all(batch.map(async portal => {
      try {
        const opportunities = await discoverIonWavePortal(portal);
        const persisted = await persistSledOpportunities(IONWAVE_SOURCE, opportunities, {
          mode: "k12-portal-discovery",
          recordChanges: false,
          closeMissing: false,
        });
        return { portal: portal.baseUrl, ok: true, discovered: opportunities.length, stored: persisted.stored };
      } catch (error) {
        return { portal: portal.baseUrl, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }));
    for (const result of results) {
      ionwaveDiagnostics.push(result);
      if (result.ok) ionwaveStored += Number(result.stored || 0);
    }
  }

  const platformCounts = Object.entries(hits.reduce<Record<string, number>>((acc, h) => {
    acc[h.platform] = (acc[h.platform] || 0) + 1;
    return acc;
  }, {}));

  return NextResponse.json({
    ok: true,
    shard,
    shardCount,
    districtsScanned: rows.length,
    pagesScanned: scanned.reduce((sum, r) => sum + r.pages, 0),
    portalHits: hits.length,
    platformCounts: Object.fromEntries(platformCounts),
    ionwavePortals: ionwave.length,
    ionwaveStored,
    ionwaveDiagnostics,
  });
}
