import * as cheerio from "cheerio";
import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";
import { discoverIonWavePortal, IONWAVE_SOURCE, type IonWavePortal } from "@/lib/sled/ionwave";
import { persistSledOpportunities } from "@/lib/sled/persistence";
import type { SledOpportunityRecord, SledSourceConfig } from "@/lib/sled/types";

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
const BID_LINK_RE = /\b(rfp|rfq|ifb|itb|bid|bids|solicitation|invitation to bid|request for proposal|request for quote|request for qualification|competitive sealed proposal|csp)\b/i;
const GENERIC_LINK_RE = /^(bids?|rfps?|rfqs?|solicitations?|procurement|purchasing|vendors?|current bids?|open bids?|bid opportunities|doing business)$/i;

const DIRECT_K12_SOURCE: SledSourceConfig = {
  adapterKey: "k12_direct_web",
  sourceName: "K-12 District Procurement Websites",
  baseUrl: "https://nces.ed.gov",
  jurisdiction: "United States",
  sourceType: "website",
};

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

function parseDueAt(text: string) {
  const match = text.match(/(?:due|deadline|closes?|closing|responses? due|proposals? due)\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-](?:\d{2}|\d{4}))(?:\s+(\d{1,2}:\d{2}\s*(?:am|pm)?))?/i);
  if (!match) return null;
  const parsed = new Date(`${match[1]} ${match[2] || "23:59"}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function directRecord(agency: Agency, title: string, sourceUrl: string, context: string): SledOpportunityRecord | null {
  const cleanTitle = title.replace(/\s+/g, " ").trim().replace(/^[-–—:|\s]+|[-–—:|\s]+$/g, "");
  if (cleanTitle.length < 8 || cleanTitle.length > 220 || GENERIC_LINK_RE.test(cleanTitle)) return null;
  if (!BID_LINK_RE.test(`${cleanTitle} ${sourceUrl}`)) return null;
  const stateCode = agency.state_code?.trim() || null;
  if (!stateCode) return null;
  const externalId = createHash("sha256").update(`${agency.id}|${sourceUrl}|${cleanTitle}`).digest("hex").slice(0, 32);
  const upper = cleanTitle.toUpperCase();
  const solicitationType = /\bRFP\b/.test(upper) ? "RFP" : /\bRFQ\b/.test(upper) ? "RFQ" : /\b(?:IFB|ITB)\b/.test(upper) ? "IFB" : /\bCSP\b/.test(upper) ? "CSP" : /\bBID\b/.test(upper) ? "Bid" : null;
  return {
    externalId,
    agency: {
      key: agency.id,
      name: agency.canonical_name,
      agencyType: "k12",
      jurisdictionLevel: "local",
      stateCode,
      city: agency.city,
      county: agency.county,
      website: agency.website,
    },
    title: cleanTitle,
    description: context.slice(0, 1500) || null,
    solicitationType,
    procurementMechanism: "district solicitation",
    status: "open",
    issueDate: null,
    dueAt: parseDueAt(context),
    prebidAt: null,
    estimatedValue: null,
    stateCode,
    city: agency.city,
    naicsCodes: [],
    setAside: null,
    sourceUrl,
    rawPayload: {
      discoveryMode: "direct-district-web",
      agencyId: agency.id,
      agencyWebsite: agency.website,
      title: cleanTitle,
      sourceUrl,
      context: context.slice(0, 2000),
    },
  };
}

function extractPage(html: string, pageUrl: string, agency: Agency) {
  const $ = cheerio.load(html);
  const hits: PortalHit[] = [];
  const internal: string[] = [];
  const direct: SledOpportunityRecord[] = [];
  const base = safeUrl(pageUrl);
  if (!base) return { hits, internal, direct };

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

    const context = $(el).closest("tr,li,article,section,div,p").first().text().replace(/\s+/g, " ").trim();
    const likelyDocument = /\.(pdf|docx?|xlsx?)($|\?)/i.test(u.pathname + u.search);
    const likelyOpportunityLink = BID_LINK_RE.test(`${label} ${u.pathname}`) && (likelyDocument || label.length >= 8);
    if (likelyOpportunityLink) {
      const record = directRecord(agency, label || u.pathname.split("/").pop() || "", u.toString(), context || label);
      if (record) direct.push(record);
    }
  });

  return {
    hits,
    internal: [...new Set(internal)].slice(0, 4),
    direct: [...new Map(direct.map(r => [r.externalId, r])).values()],
  };
}

async function scanAgency(agency: Agency) {
  const seed = safeUrl(agency.website);
  if (!seed) return { agency, pages: 0, hits: [] as PortalHit[], direct: [] as SledOpportunityRecord[] };
  const first = await fetchHtml(seed.toString());
  if (!first) return { agency, pages: 0, hits: [] as PortalHit[], direct: [] as SledOpportunityRecord[] };

  let pages = 1;
  const firstResult = extractPage(first.html, first.finalUrl, agency);
  const hits = [...firstResult.hits];
  const direct = [...firstResult.direct];

  for (const url of firstResult.internal) {
    const page = await fetchHtml(url);
    if (!page) continue;
    pages++;
    const result = extractPage(page.html, page.finalUrl, agency);
    hits.push(...result.hits);
    direct.push(...result.direct);
  }

  const uniqueHits = new Map<string, PortalHit>();
  for (const hit of hits) {
    const u = safeUrl(hit.url);
    if (!u) continue;
    uniqueHits.set(`${hit.platform}|${u.hostname}`, hit);
  }
  return {
    agency,
    pages,
    hits: [...uniqueHits.values()],
    direct: [...new Map(direct.map(r => [r.externalId, r])).values()],
  };
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
  const shardCount = 120;
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
  for (let i = 0; i < rows.length; i += 16) {
    scanned.push(...await Promise.all(rows.slice(i, i + 16).map(scanAgency)));
  }

  const hits = scanned.flatMap(r => r.hits);
  const directRecords = [...new Map(scanned.flatMap(r => r.direct).map(r => [r.externalId, r])).values()];
  let directStored = 0;
  if (directRecords.length) {
    const persisted = await persistSledOpportunities(DIRECT_K12_SOURCE, directRecords, {
      mode: "k12-direct-web",
      recordChanges: false,
      closeMissing: false,
    });
    directStored = persisted.stored;
  }

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
    directDiscovered: directRecords.length,
    directStored,
    portalHits: hits.length,
    platformCounts: Object.fromEntries(platformCounts),
    ionwavePortals: ionwave.length,
    ionwaveStored,
    ionwaveDiagnostics,
  });
}
