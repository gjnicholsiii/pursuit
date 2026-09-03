alter table contracts add column if not exists external_contract_id text;
alter table contracts add column if not exists source_url text;
create unique index if not exists idx_contracts_external_source_unique on contracts(external_contract_id, source_url);
