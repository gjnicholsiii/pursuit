import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internal-auth";
import { syncDiscoveredBonfirePortals, type DiscoveredBonfirePortal } from "@/lib/sled/bonfire-discovered";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SHARD_COUNT = 240;
const SLOT_MS = 5 * 60 * 1000;
const RUN_BUDGET_MS = 220_000;

type Agency = { id:string; canonical_name:string; state_code:string|null; city:string|null; website:string };

function safeUrl(raw:string, base?:string) {
  try {
    const url = new URL(raw, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return null;
    return url;
  } catch { return null; }
}

async function fetchHtml(url:string) {
  try {
    const response = await fetch(url, {
      redirect:"follow",
      cache:"no-store",
      signal:AbortSignal.timeout(6500),
      headers:{ "user-agent":"Mozilla/5.0 (compatible; Pursuit-K12-Bonfire-Family/1.0)", accept:"text/html,application/xhtml+xml" },
    });
    if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().includes("html")) return null;
    return { html:await response.text(), finalUrl:response.url || url };
  } catch { return null; }
}

function extractBonfirePortals(html:string, pageUrl:string, agency:Agency) {
  const $ = cheerio.load(html);
  const portals = new Map<string,DiscoveredBonfirePortal>();
  $("a[href],iframe[src]").each((_,node) => {
    const raw = $(node).attr("href") || $(node).attr("src") || "";
    const url = safeUrl(raw,pageUrl);
    if (!url || !/(^|\.)bonfirehub\.com$/i.test(url.hostname)) return;
    const match = url.hostname.match(/^([a-z0-9-]+)\.bonfirehub\.com$/i);
    if (!match || !agency.state_code) return;
    const slug = match[1].toLowerCase();
    if (["www","support","help","login","app"].includes(slug)) return;
    portals.set(slug,{slug,agencyName:agency.canonical_name,stateCode:agency.state_code.trim(),city:agency.city,agencyType:"k12",jurisdictionLevel:"education"});
  });
  return [...portals.values()];
}

async function scanAgency(agency:Agency) {
  const seed = safeUrl(agency.website);
  if (!seed) return [] as DiscoveredBonfirePortal[];
  const first = await fetchHtml(seed.toString());
  if (!first) return [];
  const pages = new Set<string>();
  const portals = new Map<string,DiscoveredBonfirePortal>();
  const harvest = (html:string,url:string) => {
    for (const portal of extractBonfirePortals(html,url,agency)) portals.set(portal.slug,portal);
    const $ = cheerio.load(html);
    $("a[href]").each((_,node) => {
      const href = $(node).attr("href") || "";
      const label = $(node).text().replace(/\s+/g," ").trim();
      const next = safeUrl(href,url);
      if (!next || next.hostname !== seed.hostname) return;
      if (/procurement|purchasing|bids?|rfps?|solicitations?|vendors?/i.test(`${label} ${next.pathname}`)) {
        next.hash="";
        pages.add(next.toString());
      }
    });
  };
  harvest(first.html,first.finalUrl);
  for (const page of [...pages].slice(0,3)) {
    const response = await fetchHtml(page);
    if (response) harvest(response.html,response.finalUrl);
  }
  return [...portals.values()];
}

export async function GET(request:NextRequest) {
  const auth = requireInternalAuth(request); if (auth) return auth;
  const started = Date.now();
  const shard = Math.floor(started / SLOT_MS) % SHARD_COUNT;
  const sql = getSql();
  const rows = await sql.query(`select id::text,canonical_name,state_code::text,city,website from agencies where agency_type='k12' and website is not null and website<>'' and state_code is not null and mod(abs(hashtextextended(id::text,17)),$1::bigint)=$2::bigint order by canonical_name`,[SHARD_COUNT,shard]) as Agency[];
  const portals = new Map<string,DiscoveredBonfirePortal>();
  for (let i=0; i<rows.length && Date.now()-started<RUN_BUDGET_MS; i+=10) {
    const found = await Promise.all(rows.slice(i,i+10).map(scanAgency));
    for (const portal of found.flat()) portals.set(portal.slug,portal);
  }
  const sync = Date.now()-started<RUN_BUDGET_MS ? await syncDiscoveredBonfirePortals([...portals.values()]) : {portals:portals.size,succeeded:0,failed:0,stored:0,diagnostics:[]};
  return NextResponse.json({ok:true,shard,shardCount:SHARD_COUNT,districtsSelected:rows.length,portalsDiscovered:portals.size,...sync,elapsedMs:Date.now()-started});
}
