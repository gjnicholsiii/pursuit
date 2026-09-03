create table if not exists organizations (
  id bigserial primary key,
  organization_name text not null,
  organization_type text,
  city text,
  state text,
  website text,
  created_at timestamptz not null default now()
);

create table if not exists source_evidence (
  id bigserial primary key,
  source_type text not null,
  source_title text not null,
  source_url text not null,
  publisher text,
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  excerpt text,
  content_hash text,
  unique(source_url, content_hash)
);

create table if not exists projects (
  id bigserial primary key,
  organization_id bigint not null references organizations(id) on delete cascade,
  project_title text not null,
  location_text text,
  project_stage text not null default 'unknown',
  estimated_value numeric(16,2),
  expected_procurement_start date,
  expected_procurement_end date,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_disciplines (
  project_id bigint not null references projects(id) on delete cascade,
  discipline text not null check (discipline in ('Access Control','Video Surveillance','Intrusion','Fire Alarm','Structured Cabling / Fiber','Intercom / Mass Notification','AV','Nurse Call','DAS')),
  confidence smallint not null default 50 check (confidence between 0 and 100),
  primary key(project_id, discipline)
);

create table if not exists signals (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  evidence_id bigint not null references source_evidence(id) on delete restrict,
  trigger_type text not null,
  trigger_summary text not null,
  score smallint not null check (score between 0 and 100),
  confidence text not null check (confidence in ('HIGH','MEDIUM','LOW')),
  buying_window text,
  detected_at timestamptz not null default now(),
  unique(project_id, evidence_id, trigger_type)
);

create table if not exists pursuits (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  solicitation_number text,
  due_at timestamptz,
  fit_score smallint check (fit_score between 0 and 100),
  incumbent_text text,
  engineer_text text,
  prebid_requirement text,
  document_count integer not null default 0,
  source_url text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contracts (
  id bigserial primary key,
  organization_id bigint not null references organizations(id) on delete cascade,
  contract_title text not null,
  incumbent_name text not null,
  award_value numeric(16,2),
  award_date date,
  current_end_date date,
  initial_term_months integer,
  renewal_options text,
  source_evidence_id bigint references source_evidence(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contract_disciplines (
  contract_id bigint not null references contracts(id) on delete cascade,
  discipline text not null check (discipline in ('Access Control','Video Surveillance','Intrusion','Fire Alarm','Structured Cabling / Fiber','Intercom / Mass Notification','AV','Nurse Call','DAS')),
  primary key(contract_id, discipline)
);

create table if not exists rebid_predictions (
  id bigserial primary key,
  contract_id bigint not null references contracts(id) on delete cascade,
  probability smallint not null check (probability between 0 and 100),
  procurement_window text,
  rationale text,
  generated_at timestamptz not null default now(),
  unique(contract_id, generated_at)
);

create table if not exists spec_mentions (
  id bigserial primary key,
  project_id bigint not null references projects(id) on delete cascade,
  evidence_id bigint not null references source_evidence(id) on delete restrict,
  manufacturer text not null,
  product text,
  discipline text check (discipline is null or discipline in ('Access Control','Video Surveillance','Intrusion','Fire Alarm','Structured Cabling / Fiber','Intercom / Mass Notification','AV','Nurse Call','DAS')),
  specifying_firm text,
  mention_text text,
  detected_at timestamptz not null default now()
);

create index if not exists idx_projects_org on projects(organization_id);
create index if not exists idx_projects_stage on projects(project_stage);
create index if not exists idx_signals_score on signals(score desc);
create index if not exists idx_signals_detected on signals(detected_at desc);
create index if not exists idx_pursuits_due on pursuits(due_at);
create index if not exists idx_contracts_incumbent on contracts(incumbent_name);
create index if not exists idx_contracts_end on contracts(current_end_date);
create index if not exists idx_rebids_probability on rebid_predictions(probability desc);
create index if not exists idx_spec_manufacturer on spec_mentions(manufacturer);
create index if not exists idx_spec_product on spec_mentions(product);
