import { neon } from "@neondatabase/serverless";
import type { LVFederalContract } from "@/lib/lv-usaspending";

type Row = Record<string, unknown>;

function rows(value: unknown) {
  return value as Row[];
}

function sqlClient() {
  const url = process.env.LOW_VOLTAGE_DATABASE_URL;
  return url ? neon(url) : null;
}

function awardSourceUrl(contract: LVFederalContract) {
  return contract.generatedId
    ? `https://www.usaspending.gov/award/${encodeURIComponent(contract.generatedId)}/`
    : "https://www.usaspending.gov/";
}

export async function persistLVContract(contract: LVFederalContract) {
  const sql = sqlClient();
  if (!sql) return { stored: false, reason: "LOW_VOLTAGE_DATABASE_URL not configured" };

  const externalId = contract.generatedId || contract.awardId;
  const sourceUrl = awardSourceUrl(contract);
  const existing = rows(await sql`
    select id from contracts
    where external_contract_id = ${externalId}
      and source_url = ${sourceUrl}
    limit 1
  `);
  if (existing.length) return { stored: false, reason: "already_exists", contractId: Number(existing[0].id) };

  const owner = contract.subAgency || contract.agency;
  const existingOrg = rows(await sql`
    select id from organizations
    where organization_name = ${owner}
    order by id asc
    limit 1
  `);
  let organizationId: number;
  if (existingOrg.length) {
    organizationId = Number(existingOrg[0].id);
  } else {
    const insertedOrg = rows(await sql`
      insert into organizations (organization_name, organization_type)
      values (${owner}, 'federal_agency')
      returning id
    `);
    organizationId = Number(insertedOrg[0].id);
  }

  const evidenceRows = rows(await sql`
    insert into source_evidence (source_type, source_title, source_url, publisher, published_at, excerpt, content_hash)
    values ('federal_award', ${contract.description}, ${sourceUrl}, 'USAspending.gov', ${contract.lastModifiedDate || contract.startDate || null}, ${contract.description}, ${externalId})
    on conflict (source_url, content_hash) do update set retrieved_at = now()
    returning id
  `);
  const evidenceId = Number(evidenceRows[0].id);

  const contractRows = rows(await sql`
    insert into contracts (
      organization_id, external_contract_id, source_url, contract_title, incumbent_name,
      award_value, award_date, current_end_date, source_evidence_id
    ) values (
      ${organizationId}, ${externalId}, ${sourceUrl}, ${contract.description}, ${contract.incumbent},
      ${contract.amount || null}, ${contract.startDate ? contract.startDate.slice(0, 10) : null}, ${contract.endDate ? contract.endDate.slice(0, 10) : null}, ${evidenceId}
    ) returning id
  `);
  const contractId = Number(contractRows[0].id);

  for (const match of contract.classification.disciplines) {
    await sql`
      insert into contract_disciplines (contract_id, discipline)
      values (${contractId}, ${match.discipline})
      on conflict (contract_id, discipline) do nothing
    `;
  }

  await sql`
    insert into rebid_predictions (contract_id, probability, procurement_window, rationale)
    values (${contractId}, ${contract.rebid.score}, ${contract.rebid.procurementWindow}, ${JSON.stringify(contract.rebid.reasons)})
  `;

  return { stored: true, contractId, evidenceId, rebidScore: contract.rebid.score };
}
