import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import { OpportunityCard } from "@/components/opportunity-card";
import { Sidebar } from "@/components/sidebar";
import { getCurrentCustomerProfile, getCustomerMatches } from "@/lib/customer-profile";
import { getSql } from "@/lib/db";
import { getStoredFederalCount, getStoredSledCount } from "@/lib/opportunity-store";
import type { Opportunity } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type InventorySource = "all" | "federal" | "sled";
type SearchScope = "matches" | "all";

type SearchRow = {
  id: string;
  agency: string;
  agency_type: string;
  adapter_key: string;
  source_name: string;
  title: string;
  solicitation_type: string | null;
  due_at: string | null;
  estimated_value: string | number | null;
  state_code: string | null;
  city: string | null;
  naics_codes: string[] | null;
  set_aside: string | null;
  source_url: string;
  external_id: string | null;
  document_identified: number | string | null;
  document_fetched: number | string | null;
  document_analyzed: number | string | null;
  document_missing: number | string | null;
  matching_count: number | string;
};

const STATE_CODES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function displayDate(value: string | null) {
  if (!value) return "Not stated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not stated";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function documentUncertainty(row: SearchRow) {
  const identified = Number(row.document_identified || 0);
  const fetched = Number(row.document_fetched || 0);
  const analyzed = Number(row.document_analyzed || 0);
  const missing = Number(row.document_missing || 0);
  if (identified === 0) return "No bid-package documents have been identified in Pursuit yet.";
  if (missing > 0) return `${missing} identified package document${missing === 1 ? " is" : "s are"} marked missing.`;
  if (fetched < identified) return `${identified - fetched} identified package document${identified - fetched === 1 ? " is" : "s are"} still awaiting acquisition.`;
  if (analyzed < fetched) return `${fetched - analyzed} fetched package document${fetched - analyzed === 1 ? " is" : "s are"} still awaiting analysis.`;
  return "All currently identified package documents have been analyzed; package completeness still needs source confirmation.";
}

function confidence(row: SearchRow) {
  let score = row.adapter_key === "sam_gov" ? 38 : 42;
  if (row.due_at) score += 10;
  if (row.external_id) score += 7;
  if (row.naics_codes?.length) score += 5;
  if (row.set_aside) score += 5;
  if (row.city || row.state_code) score += 5;
  if (Number(row.document_identified || 0) > 0) score += 7;
  return Math.min(score, 78);
}

function toOpportunity(row: SearchRow): Opportunity {
  const federal = row.adapter_key === "sam_gov";
  const uncertainty = [documentUncertainty(row)];
  const verified: string[] = [];
  if (row.due_at) verified.push(`Response deadline published by ${federal ? "SAM.gov" : row.source_name}`);
  if (row.external_id) verified.push(`Solicitation ${row.external_id}`);
  if (row.naics_codes?.[0]) verified.push(`NAICS ${row.naics_codes[0]}`);
  if (row.set_aside) verified.push(`Set-aside: ${row.set_aside}`);

  return {
    id: row.id,
    agency: row.agency,
    title: row.title,
    location: row.city && row.state_code ? `${row.city}, ${row.state_code}` : row.city || row.state_code || "Location not stated",
    value: row.estimated_value == null ? null : Number(row.estimated_value),
    due: displayDate(row.due_at),
    confidence: confidence(row),
    eligibility: "review",
    procurementPath: row.solicitation_type || (federal ? "Federal opportunity" : "SLED opportunity"),
    stage: "new",
    source: `${federal ? "SAM.gov" : row.source_name} stored in Pursuit`,
    sourceUrl: row.source_url,
    solicitationNumber: row.external_id || undefined,
    naicsCode: row.naics_codes?.[0],
    setAside: row.set_aside || undefined,
    tags: federal ? ["Federal", row.solicitation_type || "Opportunity"] : ["SLED", row.agency_type, row.solicitation_type || "Opportunity"],
    verified,
    uncertainty,
    nextStep: "Review the source record and available package intelligence before making a bid decision.",
  };
}

async function searchInventory(query: string, source: InventorySource, state: string) {
  const sql = getSql();
  const clauses = ["o.status = 'open'", "(o.due_at is null or o.due_at >= now())"];
  const values: unknown[] = [];

  if (source === "federal") clauses.push("s.adapter_key = 'sam_gov'");
  else if (source === "sled") clauses.push("s.source_family = 'sled'");
  else clauses.push("(s.adapter_key = 'sam_gov' or s.source_family = 'sled')");

  if (state && STATE_CODES.includes(state)) {
    values.push(state);
    clauses.push(`o.state_code = $${values.length}`);
  }

  if (query) {
    values.push(query);
    const p = `$${values.length}`;
    clauses.push(`(
      o.title ilike '%' || ${p} || '%'
      or coalesce(o.description, '') ilike '%' || ${p} || '%'
      or a.canonical_name ilike '%' || ${p} || '%'
      or coalesce(o.external_id, '') ilike '%' || ${p} || '%'
      or coalesce(o.solicitation_type, '') ilike '%' || ${p} || '%'
      or array_to_string(o.naics_codes, ' ') ilike '%' || ${p} || '%'
      or coalesce(o.raw_payload->>'classificationCode','') ilike '%' || ${p} || '%'
    )`);
  }

  values.push(500);
  const limitParam = `$${values.length}`;
  const rows = await sql.query(`
    select
      o.id, a.canonical_name as agency, a.agency_type, s.adapter_key, s.source_name,
      o.title, o.solicitation_type, o.due_at, o.estimated_value, o.state_code, o.city,
      o.naics_codes, o.set_aside, o.source_url, o.external_id,
      coalesce(ds.identified, 0)::int as document_identified,
      coalesce(ds.fetched, 0)::int as document_fetched,
      coalesce(ds.analyzed, 0)::int as document_analyzed,
      coalesce(ds.missing, 0)::int as document_missing,
      count(*) over()::int as matching_count
    from opportunities o
    join agencies a on a.id = o.agency_id
    join sources s on s.id = o.source_id
    left join (
      select opportunity_id, count(*)::int as identified,
        count(*) filter (where fetched_at is not null)::int as fetched,
        count(*) filter (where extraction_status in ('complete', 'extracted', 'analyzed'))::int as analyzed,
        count(*) filter (where is_missing)::int as missing
      from opportunity_documents group by opportunity_id
    ) ds on ds.opportunity_id = o.id
    where ${clauses.join(" and ")}
    order by o.due_at asc nulls last, o.last_seen_at desc
    limit ${limitParam}
  `, values) as SearchRow[];

  return { opportunities: rows.map(toOpportunity), total: Number(rows[0]?.matching_count || 0) };
}

export default async function OpportunitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = first(params.q).trim();
  const rawSource = first(params.source);
  const source: InventorySource = rawSource === "federal" || rawSource === "sled" ? rawSource : "all";
  const state = first(params.state).toUpperCase();
  const profile = await getCurrentCustomerProfile();
  const requestedScope = first(params.scope);
  const scope: SearchScope = profile && requestedScope !== "all" ? "matches" : "all";
  const thresholdInput = Number(first(params.match) || "45");
  const threshold = Number.isFinite(thresholdInput) ? Math.max(0, Math.min(100, thresholdInput)) : 45;

  let opportunities: Opportunity[] = [];
  let matchingCount = 0;
  let federalCount = 0;
  let sledCount = 0;
  let dataError: string | undefined;

  try {
    const [results, federalTotal, sledTotal] = await Promise.all([
      scope === "matches" && profile
        ? getCustomerMatches(profile, { limit: 500, threshold, query, source, state: STATE_CODES.includes(state) ? state : "" }).then(items => ({ opportunities: items, total: items.length }))
        : searchInventory(query, source, state),
      getStoredFederalCount(),
      getStoredSledCount(),
    ]);
    opportunities = results.opportunities;
    matchingCount = results.total;
    federalCount = federalTotal;
    sledCount = sledTotal;
  } catch (error) {
    dataError = error instanceof Error ? error.message : "Unable to read the live opportunity inventory";
  }

  const totalLive = federalCount + sledCount;
  const capped = scope === "all" && matchingCount > opportunities.length;

  return (
    <main className="shell">
      <Sidebar active="Opportunities" />
      <section className="workspace">
        <header className="topbar">
          <Link href={profile ? "/opportunities?scope=matches" : "/opportunities"} className="searchbox"><Search size={17} /><span>{profile ? "Search your matches or all Pursuit..." : "Search federal, state, local, K-12, higher ed..."}</span></Link>
        </header>

        <div className="content">
          <div className="hero-row inventory-hero">
            <div>
              <span className="eyebrow">{scope === "matches" ? "YOUR SEARCH" : "LIVE INVENTORY"}</span>
              <h1>{scope === "matches" ? "MY MATCHES" : "ALL OPPORTUNITIES"}</h1>
              <p>{scope === "matches" ? `Ranked against ${profile?.organizationName}'s selling profile.` : `${totalLive.toLocaleString()} current federal + SLED opportunities searchable in Pursuit.`}</p>
            </div>
            <Link href="/" className="secondary-button">Revenue Today</Link>
          </div>

          {profile && (
            <div className="inventory-summary">
              <div><strong>{scope === "matches" ? "My Matches" : "All Pursuit"}</strong><span>current search scope</span></div>
              <Link href={scope === "matches" ? "/opportunities?scope=all" : "/opportunities?scope=matches"}>{scope === "matches" ? "Search all Pursuit" : "Return to my matches"}</Link>
              <Link href="/profile">Edit selling profile</Link>
            </div>
          )}

          <form className="opportunity-filters" action="/opportunities" method="get">
            <input type="hidden" name="scope" value={scope} />
            <label className="filter-search">
              <Search size={16} />
              <input name="q" defaultValue={query} placeholder="Agency, keyword, NAICS, PSC, solicitation..." />
            </label>
            <label>
              <span>Source</span>
              <select name="source" defaultValue={source}>
                <option value="all">Federal + SLED</option>
                <option value="federal">Federal</option>
                <option value="sled">SLED</option>
              </select>
            </label>
            <label>
              <span>State</span>
              <select name="state" defaultValue={STATE_CODES.includes(state) ? state : ""}>
                <option value="">All states</option>
                {STATE_CODES.map(code => <option key={code} value={code}>{code}</option>)}
              </select>
            </label>
            {scope === "matches" && (
              <label>
                <span>Minimum match</span>
                <select name="match" defaultValue={String(threshold)}>
                  <option value="80">80%+ excellent fits</option>
                  <option value="60">60%+ strong fits</option>
                  <option value="45">45%+ relevant</option>
                  <option value="25">25%+ broad</option>
                  <option value="0">Any profile match</option>
                </select>
              </label>
            )}
            <button type="submit" className="filter-button"><SlidersHorizontal size={15} />Filter</button>
          </form>

          <div className="inventory-summary">
            <div><strong>{matchingCount.toLocaleString()}</strong><span>{scope === "matches" ? "ranked matches shown" : "matching opportunities"}</span></div>
            <div><strong>{federalCount.toLocaleString()}</strong><span>federal live</span></div>
            <div><strong>{sledCount.toLocaleString()}</strong><span>SLED live</span></div>
            {(query || source !== "all" || state || (scope === "matches" && threshold !== 45)) && <Link href={scope === "matches" ? "/opportunities?scope=matches" : "/opportunities?scope=all"}>Clear filters</Link>}
          </div>

          {capped && <p className="inventory-note">Showing the first 500 matches. Refine the filters to narrow the result set.</p>}

          {dataError && (
            <section className="readiness-panel"><div className="readiness-copy"><span className="eyebrow">LIVE DATA</span><h2>Opportunity inventory connection needs attention.</h2><p>{dataError}</p></div></section>
          )}

          <section className="section-block inventory-results">
            <div className="section-heading"><div><span>SEARCH RESULTS</span><h2>{opportunities.length ? scope === "matches" ? "Ranked for your company" : "Current opportunities" : "No matching opportunities"}</h2></div></div>
            {opportunities.length > 0 ? (
              <div className="opportunity-list">{opportunities.map(item => <OpportunityCard key={item.id} opportunity={item} />)}</div>
            ) : (
              <div className="empty-state"><Search size={20} /><strong>Nothing matches those filters.</strong><p>{scope === "matches" ? "Lower the match threshold, edit your profile, or deliberately search all Pursuit." : "Clear one or more filters to widen the live inventory."}</p></div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
