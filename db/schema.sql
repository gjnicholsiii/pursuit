-- Pursuit core PostgreSQL schema (MVP)
create extension if not exists pgcrypto;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text,
  created_at timestamptz not null default now()
);

create table selling_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  territories text[] not null default '{}',
  capability_terms text[] not null default '{}',
  naics_codes text[] not null default '{}',
  certifications text[] not null default '{}',
  contract_vehicles text[] not null default '{}',
  small_business_statuses text[] not null default '{}',
  min_contract_value numeric,
  max_contract_value numeric,
  bonding_limit numeric,
  notes text,
  updated_at timestamptz not null default now()
);

create table readiness_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  credential_type text not null,
  credential_value text,
  status text not null check (status in ('verified','review','missing','expired')),
  valid_through date,
  evidence jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  source_family text not null,
  source_name text not null,
  base_url text not null,
  jurisdiction text,
  source_type text not null check (source_type in ('api','licensed_feed','portal','website','document_index')),
  adapter_key text not null,
  active boolean not null default true,
  health_score numeric not null default 100,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table agencies (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  agency_type text not null,
  jurisdiction_level text not null,
  state_code char(2),
  city text,
  county text,
  website text,
  nces_id text,
  created_at timestamptz not null default now()
);
create index agencies_name_idx on agencies using gin (to_tsvector('english', canonical_name));
-- Stable NCES IDs let the national K-12 reconciliation update districts without name-only duplication.
create unique index agencies_nces_id_uidx on agencies(nces_id) where nces_id is not null;
create index agencies_k12_state_name_idx on agencies(state_code, lower(canonical_name)) where agency_type='k12';

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id),
  source_id uuid not null references sources(id),
  external_id text,
  title text not null,
  description text,
  solicitation_type text,
  procurement_mechanism text,
  status text not null default 'open',
  issue_date date,
  due_at timestamptz,
  prebid_at timestamptz,
  estimated_value numeric,
  state_code char(2),
  city text,
  naics_codes text[] not null default '{}',
  set_aside text,
  source_url text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  content_hash text,
  raw_payload jsonb not null default '{}',
  unique(source_id, external_id)
);
create index opportunities_due_idx on opportunities(due_at);
create index opportunities_state_idx on opportunities(state_code);
create index opportunities_search_idx on opportunities using gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));

create table opportunity_documents (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  document_type text,
  filename text not null,
  source_url text not null,
  storage_key text,
  content_hash text,
  referenced_by text,
  published_at timestamptz,
  fetched_at timestamptz,
  extraction_status text not null default 'pending',
  is_missing boolean not null default false
);

create table extracted_facts (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  document_id uuid references opportunity_documents(id) on delete set null,
  fact_type text not null,
  normalized_value jsonb not null default '{}',
  source_text text,
  evidence_locator jsonb not null default '{}',
  extraction_confidence numeric,
  superseded_by uuid references extracted_facts(id),
  created_at timestamptz not null default now()
);

create table requirements (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  document_id uuid references opportunity_documents(id) on delete set null,
  category text not null,
  requirement_text text not null,
  mandatory boolean not null default false,
  evidence_locator jsonb not null default '{}',
  normalized_value jsonb not null default '{}',
  extraction_confidence numeric,
  created_at timestamptz not null default now()
);

create table opportunity_changes (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  change_type text not null,
  summary text not null,
  before_value jsonb,
  after_value jsonb,
  evidence jsonb not null default '{}',
  detected_at timestamptz not null default now()
);

create table eligibility_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  status text not null check (status in ('ready','review','blocked')),
  satisfied jsonb not null default '[]',
  unresolved jsonb not null default '[]',
  blockers jsonb not null default '[]',
  evaluated_at timestamptz not null default now(),
  unique(organization_id, opportunity_id)
);

create table confidence_results (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  completeness_score integer check (completeness_score between 0 and 100),
  consistency_score integer check (consistency_score between 0 and 100),
  provenance_score integer check (provenance_score between 0 and 100),
  reasons jsonb not null default '[]',
  missing_items jsonb not null default '[]',
  model_version text,
  calculated_at timestamptz not null default now()
);

create table opportunity_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  decision text not null check (decision in ('pursue','watch','walk')),
  reason text,
  decided_by text,
  decided_at timestamptz not null default now(),
  unique(organization_id, opportunity_id)
);

create table source_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running',
  records_seen integer not null default 0,
  records_new integer not null default 0,
  records_changed integer not null default 0,
  documents_fetched integer not null default 0,
  error_count integer not null default 0,
  diagnostics jsonb not null default '{}'
);
