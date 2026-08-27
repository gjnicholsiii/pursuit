import { getSql } from "@/lib/db";

/**
 * Merge unresolved K-12 procurement aliases into an authoritative NCES district
 * when the official website host is an exact, state-scoped, unique match.
 * This is intentionally stronger evidence than name similarity and remains
 * conservative: no fuzzy matching, no invented NCES IDs, and no cross-state
 * host matching. Raven people are preserved with conflict-safe upserts.
 */
export async function reconcileNcesAliasesByWebsiteHost() {
  const sql = getSql();
  const rows = await sql.query(`
    with unresolved as (
      select
        a.id,
        a.state_code,
        lower(regexp_replace(regexp_replace(coalesce(a.website,''), '^https?://(www\\.)?', '', 'i'), '/.*$', '', '')) as host
      from agencies a
      where a.agency_type='k12'
        and a.nces_id is null
        and coalesce(a.website,'') <> ''
    ),
    authoritative as (
      select
        a.id,
        a.state_code,
        lower(regexp_replace(regexp_replace(coalesce(a.website,''), '^https?://(www\\.)?', '', 'i'), '/.*$', '', '')) as host,
        count(*) over (
          partition by a.state_code,
          lower(regexp_replace(regexp_replace(coalesce(a.website,''), '^https?://(www\\.)?', '', 'i'), '/.*$', '', ''))
        ) as authoritative_count
      from agencies a
      where a.agency_type='k12'
        and a.nces_id is not null
        and coalesce(a.website,'') <> ''
    ),
    safe_losers as (
      select u.id, a.id as survivor_id
      from unresolved u
      join authoritative a
        on a.state_code=u.state_code
       and a.host=u.host
       and a.authoritative_count=1
      where length(u.host) > 5
    ),
    ranked_people as (
      select
        l.survivor_id,
        p.full_name,
        p.title,
        p.role_family,
        p.email,
        p.phone,
        p.source_url,
        p.source_type,
        p.confidence,
        p.last_verified_at,
        p.created_at,
        p.updated_at,
        row_number() over (
          partition by l.survivor_id, p.full_name, p.title
          order by p.confidence desc nulls last,
                   p.last_verified_at desc nulls last,
                   p.updated_at desc nulls last,
                   p.id
        ) as rn
      from raven_people p
      join safe_losers l on l.id=p.agency_id
    ),
    copied_people as (
      insert into raven_people (
        agency_id, full_name, title, role_family, email, phone, source_url,
        source_type, confidence, last_verified_at, created_at, updated_at
      )
      select
        survivor_id, full_name, title, role_family, email, phone,
        source_url, source_type, confidence, last_verified_at,
        created_at, updated_at
      from ranked_people
      where rn=1
      on conflict (agency_id, full_name, title) do update set
        email=coalesce(excluded.email, raven_people.email),
        phone=coalesce(excluded.phone, raven_people.phone),
        source_url=coalesce(excluded.source_url, raven_people.source_url),
        confidence=greatest(excluded.confidence, raven_people.confidence),
        last_verified_at=greatest(excluded.last_verified_at, raven_people.last_verified_at),
        updated_at=greatest(excluded.updated_at, raven_people.updated_at)
      returning agency_id
    ),
    removed_people as (
      delete from raven_people p
      using safe_losers l
      where p.agency_id=l.id
      returning p.id
    ),
    moved_relationships as (
      update raven_relationships r
      set agency_id=l.survivor_id
      from safe_losers l
      where r.agency_id=l.id
      returning r.id
    ),
    moved_runs as (
      update raven_enrichment_runs r
      set agency_id=l.survivor_id
      from safe_losers l
      where r.agency_id=l.id
      returning r.id
    ),
    moved_opportunities as (
      update opportunities o
      set agency_id=l.survivor_id
      from safe_losers l
      where o.agency_id=l.id
      returning o.id
    ),
    deleted as (
      delete from agencies a
      using safe_losers l
      where a.id=l.id
      returning a.id
    )
    select id from deleted
  `);

  return { consolidated: rows.length };
}
