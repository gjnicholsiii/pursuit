import { getSql } from "@/lib/db";

type Candidate = { id: string; survivor_id: string };

async function mergeCandidates(candidates: Candidate[]) {
  if (!candidates.length) return 0;
  const sql = getSql();
  const ids = candidates.map((row) => row.id);
  const survivors = candidates.map((row) => row.survivor_id);

  // Neon HTTP queries are separate statements. Move all known dependents first,
  // then delete only rows that are demonstrably unreferenced. This avoids the
  // undefined execution ordering of multiple data-modifying CTEs in one query.
  await sql.query(`
    update opportunities o
    set agency_id = m.survivor_id
    from unnest($1::uuid[], $2::uuid[]) as m(id, survivor_id)
    where o.agency_id = m.id
  `, [ids, survivors]);

  const deleted = await sql.query(`
    delete from agencies a
    where a.id = any($1::uuid[])
      and not exists (select 1 from opportunities o where o.agency_id = a.id)
      and not exists (select 1 from raven_people p where p.agency_id = a.id)
      and not exists (select 1 from raven_relationships r where r.agency_id = a.id)
      and not exists (select 1 from raven_enrichment_runs e where e.agency_id = a.id)
    returning a.id
  `, [ids]);

  return deleted.length;
}

export async function consolidateExactK12DuplicatesSafe() {
  const sql = getSql();

  const exact = await sql.query(`
    with ranked as (
      select
        a.id,
        first_value(a.id) over (
          partition by lower(a.canonical_name), a.state_code, coalesce(lower(a.website),'')
          order by
            (select count(*) from opportunities o where o.agency_id=a.id) desc,
            a.created_at asc,
            a.id
        ) as survivor_id,
        count(*) over (
          partition by lower(a.canonical_name), a.state_code, coalesce(lower(a.website),'')
        ) as group_size
      from agencies a
      where a.agency_type='k12' and a.nces_id is null
    )
    select r.id::text, r.survivor_id::text
    from ranked r
    where r.group_size > 1
      and r.id <> r.survivor_id
      and not exists(select 1 from raven_people p where p.agency_id=r.id)
      and not exists(select 1 from raven_relationships x where x.agency_id=r.id)
      and not exists(select 1 from raven_enrichment_runs e where e.agency_id=r.id)
    order by r.id
    limit 500
  `) as Candidate[];
  const exactDeleted = await mergeCandidates(exact);

  const normalized = await sql.query(`
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
    )
    select u.id::text, a.id::text as survivor_id
    from unresolved u
    join authoritative a
      on a.state_code=u.state_code
     and a.normalized_name=u.normalized_name
     and a.authoritative_count=1
    where length(u.normalized_name) >= 8
    order by u.id
    limit 500
  `) as Candidate[];
  const normalizedDeleted = await mergeCandidates(normalized);

  return {
    consolidated: exactDeleted + normalizedDeleted,
    exact: exactDeleted,
    normalizedToAuthoritative: normalizedDeleted,
    deferredRavenPreserving: true,
  };
}
