import { getSql } from "@/lib/db";

export async function repairNcesIdsFromDistrictUrls() {
  const sql = getSql();
  const rows = await sql.query(`
    with parsed as (
      select
        id,
        substring(website from '(?:ID2|DistrictID)=([0-9]+)') as parsed_nces
      from agencies
      where agency_type = 'k12'
        and nces_id is null
        and website ~* 'nces\\.ed\\.gov/ccd/districtsearch/district_detail\\.asp.*(?:ID2|DistrictID)=[0-9]+'
    ),
    unique_targets as (
      select parsed_nces
      from parsed
      where parsed_nces is not null
      group by parsed_nces
      having count(*) = 1
    ),
    eligible as (
      select p.id, p.parsed_nces
      from parsed p
      join unique_targets u using (parsed_nces)
      where not exists (
        select 1 from agencies a where a.nces_id = p.parsed_nces
      )
    )
    update agencies a
    set nces_id = e.parsed_nces
    from eligible e
    where a.id = e.id
    returning a.id
  `);

  return { repaired: rows.length };
}

/**
 * Some statewide procurement feeds use education-related department names that
 * look K-12-ish to a generic classifier even though they are not local education
 * agencies and therefore should never be forced into an NCES district match.
 * Keep this intentionally narrow and semantic: only obvious state oversight or
 * criminal-justice training entities are removed from the LEA reconciliation
 * denominator. School systems, special schools, academies and ambiguous boards
 * remain untouched for authoritative reconciliation.
 */
export async function reclassifyClearlyNonLeas() {
  const sql = getSql();
  const rows = await sql.query(`
    update agencies
    set agency_type='state_agency', jurisdiction_level='state'
    where agency_type='k12'
      and nces_id is null
      and jurisdiction_level in ('state','local')
      and (
        canonical_name ~* '(^|[^a-z])(state )?(department of (elementary and secondary )?education|state board of education)([^a-z]|$)'
        or canonical_name ~* '(^|[^a-z])justice academy([^a-z]|$)'
        or canonical_name ~* '^state\\s*-\\s*education$'
        or canonical_name ~* '^sbe\\s*-\\s*state board of education$'
      )
    returning id
  `);
  return { reclassified: rows.length };
}

/**
 * Consolidate only high-confidence K-12 duplicates created by overlapping bulk
 * procurement feeds. Literal and punctuation/case-only duplicates remain
 * conservative. A final exact-identity pass can preserve Raven people and run
 * history while folding an unresolved row into an authoritative NCES agency
 * when state, canonical name and website host all agree. Fuzzy matching is
 * deliberately excluded and NCES IDs are never invented.
 */
export async function consolidateExactK12Duplicates() {
  const sql = getSql();
  const exactRows = await sql.query(`
    with ranked as (
      select
        a.id,
        first_value(a.id) over (
          partition by lower(a.canonical_name), a.state_code, coalesce(lower(a.website),'')
          order by
            (select count(*) from raven_people p where p.agency_id=a.id) desc,
            (select count(*) from opportunities o where o.agency_id=a.id) desc,
            a.created_at asc,
            a.id
        ) as survivor_id,
        count(*) over (
          partition by lower(a.canonical_name), a.state_code, coalesce(lower(a.website),'')
        ) as group_size
      from agencies a
      where a.agency_type='k12' and a.nces_id is null
    ),
    safe_losers as (
      select r.id, r.survivor_id
      from ranked r
      where r.group_size > 1
        and r.id <> r.survivor_id
        and not exists(select 1 from raven_people p where p.agency_id=r.id)
        and not exists(select 1 from raven_relationships x where x.agency_id=r.id)
        and not exists(select 1 from raven_enrichment_runs e where e.agency_id=r.id)
    ),
    moved as (
      update opportunities o
      set agency_id=l.survivor_id
      from safe_losers l
      where o.agency_id=l.id
      returning l.id
    ),
    deleted as (
      delete from agencies a
      using safe_losers l
      where a.id=l.id
      returning a.id
    )
    select id from deleted
  `);

  const normalizedRows = await sql.query(`
    with unresolved as (
      select
        a.id,
        a.state_code,
        regexp_replace(lower(a.canonical_name), '[^a-z0-9]+', '', 'g') as normalized_name
      from agencies a
      where a.agency_type='k12'
        and a.nces_id is null
        and not exists(select 1 from raven_people p where p.agency_id=a.id)
        and not exists(select 1 from raven_relationships x where x.agency_id=a.id)
        and not exists(select 1 from raven_enrichment_runs e where e.agency_id=a.id)
    ),
    authoritative as (
      select
        a.id,
        a.state_code,
        regexp_replace(lower(a.canonical_name), '[^a-z0-9]+', '', 'g') as normalized_name,
        count(*) over (
          partition by a.state_code,
          regexp_replace(lower(a.canonical_name), '[^a-z0-9]+', '', 'g')
        ) as authoritative_count
      from agencies a
      where a.agency_type='k12' and a.nces_id is not null
    ),
    safe_losers as (
      select u.id, a.id as survivor_id
      from unresolved u
      join authoritative a
        on a.state_code=u.state_code
       and a.normalized_name=u.normalized_name
       and a.authoritative_count=1
      where length(u.normalized_name) >= 8
    ),
    moved as (
      update opportunities o
      set agency_id=l.survivor_id
      from safe_losers l
      where o.agency_id=l.id
      returning l.id
    ),
    deleted as (
      delete from agencies a
      using safe_losers l
      where a.id=l.id
      returning a.id
    )
    select id from deleted
  `);

  const ravenPreservingRows = await sql.query(`
    with unresolved as (
      select
        a.id,
        a.state_code,
        lower(a.canonical_name) as exact_name,
        lower(regexp_replace(regexp_replace(coalesce(a.website,''), '^https?://(www\\.)?', '', 'i'), '/.*$', '', '')) as host
      from agencies a
      where a.agency_type='k12'
        and a.nces_id is null
        and coalesce(a.website,'') <> ''
        and not exists(select 1 from raven_relationships x where x.agency_id=a.id)
    ),
    authoritative as (
      select
        a.id,
        a.state_code,
        lower(a.canonical_name) as exact_name,
        lower(regexp_replace(regexp_replace(coalesce(a.website,''), '^https?://(www\\.)?', '', 'i'), '/.*$', '', '')) as host,
        count(*) over (
          partition by a.state_code,
          lower(a.canonical_name),
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
       and a.exact_name=u.exact_name
       and a.host=u.host
       and a.authoritative_count=1
      where length(u.host) > 5
    ),
    copied_people as (
      insert into raven_people (
        agency_id, full_name, title, role_family, email, phone, source_url,
        source_type, confidence, last_verified_at, created_at, updated_at
      )
      select
        l.survivor_id, p.full_name, p.title, p.role_family, p.email, p.phone,
        p.source_url, p.source_type, p.confidence, p.last_verified_at,
        p.created_at, p.updated_at
      from raven_people p
      join safe_losers l on l.id=p.agency_id
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

  return {
    consolidated: exactRows.length + normalizedRows.length + ravenPreservingRows.length,
    exact: exactRows.length,
    normalizedToAuthoritative: normalizedRows.length,
    ravenPreservingExactIdentity: ravenPreservingRows.length,
  };
}
