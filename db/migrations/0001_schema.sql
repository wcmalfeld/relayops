-- RelayOps core schema.
-- Conventions:
--   * Every business-owned table carries business_id.
--   * Parent tables expose UNIQUE (business_id, id) so children can use composite
--     foreign keys. A child row can therefore never reference a record that belongs
--     to a different business, even if application code has a bug.
--   * Timestamps are timestamptz. Identifiers are UUIDs.

create extension if not exists pg_trgm;

create schema if not exists app;

-- Deterministic hash of a proposal's parameters. jsonb::text is canonical
-- (keys de-duplicated and sorted), so equal parameters always hash equally.
-- Declared IMMUTABLE so it can back a generated column; the database encoding
-- is UTF8, which makes convert_to deterministic here.
create or replace function app.params_hash(p jsonb) returns text
language sql immutable parallel safe as $$
  select encode(sha256(convert_to(p::text, 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- Tenancy and identity
-- ---------------------------------------------------------------------------

create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  timezone text not null default 'America/Denver',
  support_email text,
  is_demo boolean not null default false,
  -- Validated by the application (see src/server/settings/schemas.ts).
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) between 3 and 254),
  full_name text not null check (length(full_name) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_lower_idx on profiles (lower(email));

-- Password hashes live apart from profiles so ordinary profile reads can never
-- return them. The runtime role has no privileges on this table; access goes
-- through SECURITY DEFINER functions (0002).
create table auth_credentials (
  user_id uuid primary key references profiles(id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  token_hash text not null unique,
  active_business_id uuid references businesses(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  ip_hash text
);
create index auth_sessions_user_idx on auth_sessions (user_id);

create table business_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id),
  unique (business_id, id)
);
create index business_memberships_user_idx on business_memberships (user_id);

-- ---------------------------------------------------------------------------
-- Business records (the controlled knowledge the AI may cite)
-- ---------------------------------------------------------------------------

create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  full_name text not null check (length(full_name) between 1 and 120),
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);
create unique index customers_business_email_idx on customers (business_id, lower(email)) where email is not null;
create index customers_name_trgm_idx on customers using gin (full_name gin_trgm_ops);

create table products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  sku text not null,
  name text not null,
  brand text,
  category text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  is_active boolean not null default true,
  search_vector tsvector generated always as (
    to_tsvector('english',
      coalesce(name, '') || ' ' || coalesce(brand, '') || ' ' ||
      coalesce(category, '') || ' ' || coalesce(description, '') || ' ' || sku)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, sku)
);
create index products_search_idx on products using gin (search_vector);
create index products_name_trgm_idx on products using gin (name gin_trgm_ops);

create table inventory_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null,
  location text not null default 'Main store',
  quantity_on_hand integer not null check (quantity_on_hand >= 0),
  quantity_reserved integer not null default 0 check (quantity_reserved >= 0),
  updated_at timestamptz not null default now(),
  foreign key (business_id, product_id) references products (business_id, id) on delete cascade,
  unique (business_id, product_id, location),
  unique (business_id, id)
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  order_number text not null,
  customer_id uuid not null,
  status text not null check (status in ('pending', 'processing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled')),
  fulfillment text not null check (fulfillment in ('ship', 'pickup')),
  carrier text,
  tracking_number text,
  total_cents integer not null check (total_cents >= 0),
  placed_at timestamptz not null,
  expected_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (business_id, customer_id) references customers (business_id, id),
  unique (business_id, order_number),
  unique (business_id, id)
);
create index orders_customer_idx on orders (business_id, customer_id);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  order_id uuid not null,
  product_id uuid not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  foreign key (business_id, order_id) references orders (business_id, id) on delete cascade,
  foreign key (business_id, product_id) references products (business_id, id)
);
create index order_items_order_idx on order_items (business_id, order_id);

create table business_policies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  policy_key text not null check (policy_key ~ '^[a-z0-9_]{2,64}$'),
  title text not null,
  body text not null check (length(body) <= 5000),
  categories text[] not null default '{}',
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored,
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, policy_key),
  unique (business_id, id)
);
create index business_policies_search_idx on business_policies using gin (search_vector);

-- Configurable request categories. Also holds the per-category inputs for the
-- explicit "estimated staff time saved" calculation.
create table request_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{2,48}$'),
  label text not null,
  description text not null default '',
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  baseline_manual_minutes numeric(6,1) not null default 8 check (baseline_manual_minutes >= 0),
  assisted_minutes numeric(6,1) not null default 3 check (assisted_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, key),
  unique (business_id, id)
);

-- ---------------------------------------------------------------------------
-- Customer requests and AI interpretation
-- ---------------------------------------------------------------------------

create table customer_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  reference text not null,
  customer_id uuid,
  customer_name text not null check (length(customer_name) between 1 and 120),
  customer_email text check (customer_email is null or length(customer_email) <= 254),
  customer_phone text check (customer_phone is null or length(customer_phone) <= 40),
  channel text not null check (channel in ('manual', 'demo', 'api', 'public_form')),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 8000),
  status text not null default 'new' check (status in
    ('new', 'processing', 'needs_review', 'awaiting_approval', 'approved', 'completed', 'rejected', 'failed')),
  category text,
  priority text check (priority is null or priority in ('low', 'normal', 'high', 'urgent')),
  priority_rule_id uuid,
  assigned_to uuid,
  ai_status text not null default 'not_started' check (ai_status in ('not_started', 'processing', 'completed', 'failed')),
  ai_error_code text,
  needs_human_review boolean not null default false,
  review_reasons text[] not null default '{}',
  flagged_unresolved_at timestamptz,
  external_ref text,
  idempotency_key text,
  is_demo boolean not null default false,
  created_by uuid references profiles(id),
  received_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, customer_id) references customers (business_id, id),
  -- An assignee must be a member of the same business.
  foreign key (business_id, assigned_to) references business_memberships (business_id, user_id),
  unique (business_id, id),
  unique (business_id, reference)
);
create unique index customer_requests_idempotency_idx on customer_requests (business_id, idempotency_key) where idempotency_key is not null;
create index customer_requests_status_idx on customer_requests (business_id, status, created_at desc);
create index customer_requests_category_idx on customer_requests (business_id, category);
create index customer_requests_assigned_idx on customer_requests (business_id, assigned_to);
create index customer_requests_created_idx on customer_requests (business_id, created_at desc);
create index customer_requests_text_trgm_idx on customer_requests using gin ((customer_name || ' ' || subject || ' ' || reference) gin_trgm_ops);

-- Each AI call (or AI outage) is recorded with provider metadata. Prompts and
-- completions are NOT stored here.
create table ai_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  request_id uuid not null,
  task text not null check (task in ('classify', 'summarize', 'draft_response', 'propose_actions')),
  provider text not null,
  model text not null,
  prompt_version text not null,
  status text not null check (status in ('succeeded', 'failed')),
  error_code text,
  attempts integer not null default 1,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  foreign key (business_id, request_id) references customer_requests (business_id, id) on delete cascade,
  unique (business_id, id)
);
create index ai_runs_request_idx on ai_runs (business_id, request_id, created_at);

-- Classifications are append-only history. A human correction is a new row with
-- source = 'human'; the original model output row is never edited.
create table request_classifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  request_id uuid not null,
  source text not null check (source in ('ai', 'human')),
  category text not null,
  summary text not null check (length(summary) <= 1000),
  key_points jsonb not null default '[]'::jsonb,
  extracted_fields jsonb not null default '{}'::jsonb,
  missing_information jsonb not null default '[]'::jsonb,
  uncertainty_level text check (uncertainty_level is null or uncertainty_level in ('low', 'medium', 'high')),
  uncertainty_notes text,
  suggested_next_step text,
  injection_suspected boolean not null default false,
  ai_run_id uuid,
  supersedes_id uuid references request_classifications(id),
  correction_reason text,
  is_current boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  foreign key (business_id, request_id) references customer_requests (business_id, id) on delete cascade,
  foreign key (business_id, ai_run_id) references ai_runs (business_id, id),
  unique (business_id, id)
);
create unique index request_classifications_current_idx on request_classifications (request_id) where is_current;

-- Snapshot of the business records the retrieval service returned for a
-- processing run. Proposals cite these rows as evidence.
create table retrieved_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  request_id uuid not null,
  retrieval_run_id uuid not null,
  record_type text not null check (record_type in ('customer', 'product', 'order', 'service_request', 'appointment_slot', 'policy')),
  record_id uuid not null,
  ref text not null,
  label text not null,
  facts jsonb not null,
  match_reason text not null,
  created_at timestamptz not null default now(),
  foreign key (business_id, request_id) references customer_requests (business_id, id) on delete cascade,
  unique (business_id, id)
);
create index retrieved_records_request_idx on retrieved_records (business_id, request_id, retrieval_run_id);

-- ---------------------------------------------------------------------------
-- Operational records that approved actions may create
-- ---------------------------------------------------------------------------

create table service_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  ticket_number text not null,
  customer_id uuid not null,
  customer_request_id uuid,
  bike_description text not null check (length(bike_description) <= 200),
  issue_summary text not null check (length(issue_summary) <= 1000),
  service_type text not null check (service_type in ('tune_up', 'repair', 'brake_service', 'drivetrain', 'wheel_true', 'suspension', 'ebike_diagnostic', 'fitting', 'other')),
  status text not null check (status in ('open', 'scheduled', 'in_progress', 'awaiting_parts', 'completed', 'cancelled')),
  quoted_cents integer check (quoted_cents is null or quoted_cents >= 0),
  source_proposal_id uuid,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, customer_id) references customers (business_id, id),
  foreign key (business_id, customer_request_id) references customer_requests (business_id, id),
  unique (business_id, ticket_number),
  unique (business_id, id)
);
create unique index service_requests_source_proposal_idx on service_requests (source_proposal_id) where source_proposal_id is not null;

-- Appointment slots. A slot is available until an approved action books it.
create table appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  service_type text not null check (service_type in ('tune_up', 'repair', 'brake_service', 'drivetrain', 'wheel_true', 'suspension', 'ebike_diagnostic', 'fitting', 'other', 'any')),
  technician_name text,
  status text not null default 'available' check (status in ('available', 'booked', 'cancelled')),
  customer_id uuid,
  service_request_id uuid,
  booked_by_proposal_id uuid,
  booked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((status = 'booked') = (customer_id is not null)),
  foreign key (business_id, customer_id) references customers (business_id, id),
  foreign key (business_id, service_request_id) references service_requests (business_id, id),
  unique (business_id, id)
);
create index appointments_slot_idx on appointments (business_id, status, starts_at);

-- A refund request is a record for a human to process outside RelayOps.
-- No payment integration exists; no money moves.
create table refund_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  order_id uuid not null,
  customer_id uuid not null,
  customer_request_id uuid,
  amount_cents integer not null check (amount_cents > 0),
  reason text not null check (length(reason) <= 1000),
  status text not null default 'pending_manual_review' check (status in ('pending_manual_review', 'closed')),
  source_proposal_id uuid unique,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  foreign key (business_id, order_id) references orders (business_id, id),
  foreign key (business_id, customer_id) references customers (business_id, id),
  foreign key (business_id, customer_request_id) references customer_requests (business_id, id),
  unique (business_id, id)
);

create table internal_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  request_id uuid not null,
  body text not null check (length(body) between 1 and 2000),
  author_user_id uuid references profiles(id),
  source_proposal_id uuid unique,
  created_at timestamptz not null default now(),
  foreign key (business_id, request_id) references customer_requests (business_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Action proposals, approvals and executions
-- ---------------------------------------------------------------------------

create table action_proposals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  request_id uuid not null,
  action_type text not null check (action_type in (
    'draft_customer_response', 'update_request_status', 'assign_team_member',
    'add_internal_note', 'create_service_request', 'propose_appointment', 'prepare_refund_request')),
  -- Normalized parameters after server-side validation.
  params jsonb not null,
  -- Hash of the exact parameters; approvals bind to it.
  params_hash text generated always as (app.params_hash(params)) stored,
  -- What the model (or the original author) proposed, kept for traceability.
  original_params jsonb not null,
  version integer not null default 1 check (version >= 1),
  explanation text not null check (length(explanation) <= 2000),
  evidence_refs jsonb not null default '[]'::jsonb,
  unresolved_requirements jsonb not null default '[]'::jsonb,
  -- For drafted responses: each claim with its basis (record / customer /
  -- assumption / unavailable) so reviewers can see what is confirmed.
  claims jsonb not null default '[]'::jsonb,
  -- Risk and approval requirement are computed by application policy code and
  -- workflow rules, never taken from model output.
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  requires_approval boolean not null,
  status text not null default 'draft' check (status in
    ('draft', 'pending_approval', 'approved', 'executing', 'executed', 'failed', 'rejected', 'cancelled')),
  origin text not null check (origin in ('ai', 'user', 'rule')),
  ai_run_id uuid,
  created_by uuid references profiles(id),
  last_edited_by uuid references profiles(id),
  submitted_by uuid references profiles(id),
  submitted_at timestamptz,
  executed_by uuid references profiles(id),
  executed_at timestamptz,
  execution_result jsonb,
  failure_reason text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, request_id) references customer_requests (business_id, id) on delete cascade,
  foreign key (business_id, ai_run_id) references ai_runs (business_id, id),
  unique (business_id, id)
);
create index action_proposals_request_idx on action_proposals (business_id, request_id, created_at);
create index action_proposals_status_idx on action_proposals (business_id, status, created_at desc);

-- Every edit of a proposal's parameters is preserved.
create table action_proposal_revisions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  proposal_id uuid not null,
  version integer not null,
  params jsonb not null,
  params_hash text not null,
  edited_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  foreign key (business_id, proposal_id) references action_proposals (business_id, id) on delete cascade,
  unique (proposal_id, version)
);

-- An approval binds to one proposal version and one parameter hash.
create table action_approvals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  proposal_id uuid not null,
  proposal_version integer not null,
  params_hash text not null check (params_hash ~ '^[0-9a-f]{64}$'),
  decision text not null check (decision in ('approved', 'rejected')),
  decided_by uuid not null references profiles(id),
  comment text check (comment is null or length(comment) <= 1000),
  created_at timestamptz not null default now(),
  invalidated_at timestamptz,
  invalidation_reason text,
  foreign key (business_id, proposal_id) references action_proposals (business_id, id) on delete cascade,
  foreign key (business_id, decided_by) references business_memberships (business_id, user_id)
);
create index action_approvals_proposal_idx on action_approvals (proposal_id, created_at desc);

create table workflow_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  is_enabled boolean not null default true,
  trigger text not null check (trigger in ('request.created', 'request.classified', 'request.unresolved_check', 'proposal.created')),
  conditions jsonb not null default '[]'::jsonb,
  action jsonb not null,
  requires_approval boolean not null default false,
  sort_order integer not null default 100,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

-- One row per execution attempt of a proposal or a rule effect.
create table workflow_executions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('proposal', 'rule')),
  proposal_id uuid,
  proposal_version integer,
  rule_id uuid,
  request_id uuid,
  status text not null check (status in ('succeeded', 'failed', 'skipped')),
  idempotency_key text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_user_id uuid references profiles(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (business_id, proposal_id) references action_proposals (business_id, id) on delete cascade,
  foreign key (business_id, rule_id) references workflow_rules (business_id, id) on delete set null (rule_id),
  foreign key (business_id, request_id) references customer_requests (business_id, id) on delete cascade
);
-- At most one successful execution per proposal, ever.
create unique index workflow_executions_one_success_idx on workflow_executions (proposal_id) where status = 'succeeded' and proposal_id is not null;
create unique index workflow_executions_rule_idem_idx on workflow_executions (business_id, idempotency_key) where kind = 'rule';
create index workflow_executions_request_idx on workflow_executions (business_id, request_id, started_at);

-- Outbox of customer messages. With the mock provider, every row is simulated.
create table message_deliveries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  proposal_id uuid not null unique,
  request_id uuid not null,
  customer_id uuid,
  to_address text not null,
  subject text not null,
  body text not null,
  provider text not null,
  simulated boolean not null,
  status text not null check (status in ('simulated_delivered', 'sent', 'failed')),
  provider_message_id text,
  created_at timestamptz not null default now(),
  foreign key (business_id, proposal_id) references action_proposals (business_id, id),
  foreign key (business_id, request_id) references customer_requests (business_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Audit and integrations
-- ---------------------------------------------------------------------------

-- Append-only. Kept separate from mutable request state.
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  event_type text not null check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  actor_type text not null check (actor_type in ('user', 'system', 'ai', 'public')),
  actor_user_id uuid references profiles(id),
  request_id uuid,
  entity_type text,
  entity_id uuid,
  result text not null check (result in ('success', 'failure', 'denied', 'info')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_business_idx on audit_events (business_id, created_at desc);
create index audit_events_request_idx on audit_events (business_id, request_id, created_at);
create index audit_events_type_idx on audit_events (business_id, event_type);

create table integration_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('intake_api_key')),
  name text not null check (length(name) between 1 and 80),
  key_prefix text not null,
  secret_hash text not null unique,
  is_enabled boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index integration_settings_business_idx on integration_settings (business_id);

-- Fixed-window rate limit counters shared by every app instance.
create table rate_limit_counters (
  bucket_key text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (bucket_key, window_start)
);

-- Per-business sequence for human-friendly request references (REQ-1001...).
create table business_counters (
  business_id uuid not null references businesses(id) on delete cascade,
  counter_key text not null,
  value bigint not null,
  primary key (business_id, counter_key)
);
