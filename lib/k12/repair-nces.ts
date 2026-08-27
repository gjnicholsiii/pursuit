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
 * Consolidate only the safest exact duplicate tail created by overlapping bulk
 * procurement feeds. A loser must have no Raven-side records; its opportunities
 * are moved to the better-populated survivor before the duplicate is deleted.
 * This deliberately avoids fuzzy matching and never invents an NCES identity.
 */
export async function consolidateExactK12Duplicates() {
  const sql = getSql();
  const rows = await sql.query(`
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

  return { consolidated: rows.length };
}
