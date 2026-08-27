import { getSql } from "@/lib/db";

/**
 * Consolidate unresolved K-12 agency aliases that differ from an authoritative
 * NCES district only by common administrative naming tokens used by statewide
 * procurement feeds (for example ISD, Unified, Regional, Community, Area, or
 * School System). This remains deliberately conservative: same state, exactly
 * one authoritative target, minimum normalized-name length, and no Raven person
 * identity collision. No fuzzy matching and no NCES IDs are invented.
 */
export async function reconcileExtendedNcesAliases() {
  const sql = getSql();
  const rows = await sql.query(`
    with unresolved as (
      select
        a.id,
        a.state_code,
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(a.canonical_name), ',?\\s*[a-z]{2}\\s*$', '', 'i'),
            '\\m(schools?|districts?|public|boards?|of|education|county|city|independent|unified|regional|community|area|system|isd|usd|sd)\\M',
            '',
            'g'
          ),
          '[^a-z0-9]+',
          '',
          'g'
        ) as administrative_name
      from agencies a
      where a.agency_type='k12' and a.nces_id is null
    ),
    authoritative as (
      select
        a.id,
        a.state_code,
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(a.canonical_name), ',?\\s*[a-z]{2}\\s*$', '', 'i'),
            '\\m(schools?|districts?|public|boards?|of|education|county|city|independent|unified|regional|community|area|system|isd|usd|sd)\\M',
            '',
            'g'
          ),
          '[^a-z0-9]+',
          '',
          'g'
        ) as administrative_name
      from agencies a
      where a.agency_type='k12' and a.nces_id is not null
    ),
    candidates as (
      select
        u.id,
        (array_agg(a.id order by a.id::text))[1] as survivor_id,
        count(*) as candidate_count
      from unresolved u
      join authoritative a
        on a.state_code=u.state_code
       and a.administrative_name=u.administrative_name
      where length(u.administrative_name) >= 6
      group by u.id
    ),
    safe_losers as (
      select c.id, c.survivor_id
      from candidates c
      where c.candidate_count=1
        and not exists (
          select 1
          from raven_people lp
          join raven_people sp
            on sp.agency_id=c.survivor_id
           and lp.agency_id=c.id
           and sp.full_name=lp.full_name
           and sp.title is not distinct from lp.title
        )
    ),
    moved_people as (
      update raven_people p
      set agency_id=l.survivor_id
      from safe_losers l
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
