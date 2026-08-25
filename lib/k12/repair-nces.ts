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
