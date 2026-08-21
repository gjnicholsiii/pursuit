import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FILE_EXT = /\.(pdf|docx?|xlsx?|csv|zip|txt)(?:$|[?#])/i;
const DOC_URL_HINT = /(download|attachment|document|file|resource|solicitation|specification|addendum|amendment|bid[-_ ]?package|rfp|rfq|ifb)/i;
const DOC_TEXT_HINT = /(download|attachment|document|specification|scope of work|statement of work|solicitation|addendum|amendment|bid package|pricing|bid form|rfp|rfq|ifb)/i;

function safeName(url: string, fallback = "document") {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || fallback);
    return name.replace(/[^a-zA-Z0-9._() -]+/g, "-").replace(/\s+/g, " ").trim() || fallback;
  } catch { return fallback; }
}

function isHttp(value: string) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function absolute(base: string, value: string) {
  try {
    const url = new URL(value, base).toString();
    return isHttp(url) ? url : null;
  } catch { return null; }
}

function extractQuotedUrls(value: string, base: string) {
  const urls: string[] = [];
  for (const match of value.matchAll(/["']([^"']{3,500})["']/g)) {
    const raw = match[1];
    if (!raw || raw.startsWith("javascript:")) continue;
    const url = absolute(base, raw);
    if (url) urls.push(url);
  }
  return urls;
}

type OpportunityRow = {
  id: string;
  source_url: string;
  agency_type: string;
  source_name: string;
  adapter_key: string;
  external_id: string | null;
  raw_payload: Record<string, unknown> | null;
};

type ScanResult = {
  opportunityId: string;
  agencyType: string;
  sourceName: string;
  discovered: number;
  inserted: number;
  status: number;
};

function scanUrls(opp: OpportunityRow) {
  const urls = new Set<string>([opp.source_url]);
  const raw = opp.raw_payload || {};
  for (const key of ["sourcePage", "detailUrl", "detailURL", "bidUrl", "bidURL", "url"]) {
    const value = raw[key];
    if (typeof value === "string" && isHttp(value)) urls.add(value);
  }

  if (opp.adapter_key.startsWith("periscope_") && opp.external_id) {
    try {
      const base = new URL(opp.source_url);
      const root = `${base.protocol}//${base.host}/bso/`;
      const search = new URL("view/search/external/advancedSearchBid.xhtml", root);
      search.searchParams.set("currentDocType", "bids");
      search.searchParams.set("q", opp.external_id);
      urls.add(search.toString());
    } catch {}
  }

  return [...urls].slice(0, 4);
}

async function inspectHtml(html: string, pageUrl: string, discovered: Set<string>, follow: Set<string>) {
  const $ = cheerio.load(html);

  $("a,button,[onclick],[data-url],[data-href]").each((_, el) => {
    const node = $(el);
    const text = node.text().replace(/\s+/g, " ").trim();
    const values = [node.attr("href"), node.attr("data-url"), node.attr("data-href")].filter((v): v is string => Boolean(v));
    const onclick = node.attr("onclick") || "";
    values.push(...extractQuotedUrls(onclick, pageUrl));

    for (const raw of values) {
      if (raw.startsWith("javascript:")) {
        for (const extracted of extractQuotedUrls(raw, pageUrl)) {
          if (FILE_EXT.test(extracted) || DOC_URL_HINT.test(extracted)) discovered.add(extracted);
          else if (DOC_TEXT_HINT.test(text)) follow.add(extracted);
        }
        continue;
      }
      const url = absolute(pageUrl, raw);
      if (!url) continue;
      if (FILE_EXT.test(url)) discovered.add(url);
      else if (DOC_URL_HINT.test(url) && DOC_TEXT_HINT.test(text || url)) follow.add(url);
      else if (DOC_TEXT_HINT.test(text)) follow.add(url);
    }
  });

  for (const match of html.matchAll(/https?:\/\/[^"'<>\s]+/g)) {
    const url = match[0].replace(/&amp;/g, "&");
    if (FILE_EXT.test(url)) discovered.add(url);
  }
}

async function fetchAndInspect(url: string, discovered: Set<string>, follow: Set<string>, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0", Accept: "text/html,application/pdf,application/octet-stream,*/*" },
    });
    if (!response.ok) return response.status;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/pdf") || FILE_EXT.test(response.url)) {
      discovered.add(response.url);
      return response.status;
    }
    const html = await response.text();
    await inspectHtml(html, response.url, discovered, follow);
    return response.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timeout);
  }
}

async function scanOne(opp: OpportunityRow): Promise<ScanResult> {
  const sql = getSql();
  const discovered = new Set<string>();
  const follow = new Set<string>();
  let status = 0;

  for (const url of scanUrls(opp)) {
    const current = await fetchAndInspect(url, discovered, follow);
    if (!status && current) status = current;
  }

  const sourceOrigins = new Set(scanUrls(opp).map(url => {
    try { return new URL(url).origin; } catch { return ""; }
  }).filter(Boolean));

  let followed = 0;
  for (const url of follow) {
    if (followed >= 6) break;
    try {
      const parsed = new URL(url);
      if (!sourceOrigins.has(parsed.origin)) continue;
    } catch { continue; }
    followed += 1;
    await fetchAndInspect(url, discovered, new Set<string>(), 10000);
  }

  let inserted = 0;
  for (const url of [...discovered].slice(0, 50)) {
    const result = await sql.query(
      `insert into opportunity_documents (opportunity_id, document_type, filename, source_url, referenced_by, extraction_status)
       select $1, 'sled_resource', $2, $3, $4, 'pending'
       where not exists (select 1 from opportunity_documents where opportunity_id=$1 and source_url=$3)
       returning id`,
      [opp.id, safeName(url, `${opp.agency_type}-document`), url, `${opp.source_name} source discovery`],
    ) as Array<{ id: string }>;
    inserted += result.length;
  }

  return { opportunityId: opp.id, agencyType: opp.agency_type, sourceName: opp.source_name, discovered: discovered.size, inserted, status };
}

export async function GET(request: NextRequest) {
  const auth = requireInternalAuth(request); if (auth) return auth;
  const sql = getSql();
  const rows = await sql.query(
    `select o.id, o.source_url, o.external_id, o.raw_payload, a.agency_type, s.source_name, s.adapter_key
     from opportunities o
     join agencies a on a.id=o.agency_id
     join sources s on s.id=o.source_id
     where s.source_family='sled'
       and s.adapter_key <> 'opengov_public'
       and o.status='open'
       and (o.due_at is null or o.due_at >= now())
       and not exists (select 1 from opportunity_documents d where d.opportunity_id=o.id)
     order by
       case
         when s.adapter_key like 'periscope_%' then 0
         when s.adapter_key in ('eva_vbo_va','nyscr_ny','peoplesoft_ca','texas_esbd_tx','powerpages_nc') then 1
         when a.agency_type='k12' then 2
         when a.agency_type='higher_ed' then 3
         else 4
       end,
       o.due_at asc nulls last,
       o.last_seen_at desc
     limit 100`,
  ) as OpportunityRow[];

  if (!rows.length) return NextResponse.json({ ok: true, scannedCount: 0, message: "No undiscovered open non-OpenGov SLED opportunities remain" });

  const scanned: ScanResult[] = [];
  const concurrency = 4;
  for (let i = 0; i < rows.length; i += concurrency) {
    scanned.push(...await Promise.all(rows.slice(i, i + concurrency).map(scanOne)));
  }
  const totalInserted = scanned.reduce((sum, row) => sum + row.inserted, 0);
  const withDocuments = scanned.filter(row => row.inserted > 0).length;

  return NextResponse.json({ ok: true, scannedCount: scanned.length, withDocuments, totalInserted, scanned });
}
