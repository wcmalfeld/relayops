-- Tenant context, invariants enforced by the database, and narrowly scoped
-- SECURITY DEFINER entry points for authentication.
--
-- The application sets three transaction-local settings before touching
-- business data (see src/server/db/tenant.ts):
--   app.actor        'user' | 'system'
--   app.user_id      the authenticated profile id (user actor only)
--   app.business_id  the business the request is scoped to
-- A user actor's business id is only honoured when that user holds an active
-- membership in the business, so a wrong or tampered business id yields no rows.

-- ---------------------------------------------------------------------------
-- Context helpers
-- ---------------------------------------------------------------------------

create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app.actor() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('app.actor', true), ''), 'none')
$$;

create or replace function app.current_business_id() returns uuid
language plpgsql stable security definer set search_path = public, app as $$
declare
  b uuid := nullif(current_setting('app.business_id', true), '')::uuid;
begin
  if b is null then
    return null;
  end if;
  if app.actor() = 'system' then
    return b;
  end if;
  if app.actor() = 'user' and exists (
    select 1
    from business_memberships m
    join profiles p on p.id = m.user_id
    where m.business_id = b
      and m.user_id = app.current_user_id()
      and m.status = 'active'
      and p.is_active
  ) then
    return b;
  end if;
  return null;
end
$$;

create or replace function app.current_member_role() returns text
language plpgsql stable security definer set search_path = public, app as $$
declare
  r text;
begin
  if app.actor() = 'system' and app.current_business_id() is not null then
    return 'system';
  end if;
  select m.role into r
  from business_memberships m
  where m.business_id = app.current_business_id()
    and m.user_id = app.current_user_id()
    and m.status = 'active';
  return r;
end
$$;

-- Whether the current actor may see a request with the given assignee.
-- Owners and system processes see every request in the business. Members see
-- unassigned requests and requests assigned to them, unless the business has
-- opted into member_request_visibility = 'all'.
create or replace function app.can_view_assignment(p_assigned uuid) returns boolean
language plpgsql stable security definer set search_path = public, app as $$
declare
  r text := app.current_member_role();
begin
  if r in ('owner', 'system') then
    return true;
  end if;
  if r = 'member' then
    if p_assigned is null or p_assigned = app.current_user_id() then
      return true;
    end if;
    return coalesce((
      select (b.settings ->> 'member_request_visibility') = 'all'
      from businesses b where b.id = app.current_business_id()
    ), false);
  end if;
  return false;
end
$$;

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------

-- Bumps updated_at unless the statement set it explicitly (used by imports).
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'businesses', 'profiles', 'business_memberships', 'customers', 'products',
    'business_policies', 'request_categories', 'customer_requests',
    'service_requests', 'appointments', 'action_proposals', 'workflow_rules'
  ] loop
    execute format('create trigger %I before update on %I for each row execute function app.touch_updated_at()', t || '_touch', t);
  end loop;
end
$$;

-- Audit events are append-only for every role, including the table owner.
create or replace function app.audit_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_events is append-only' using errcode = 'insufficient_privilege';
end
$$;

create trigger audit_events_no_update before update on audit_events
  for each row execute function app.audit_events_immutable();
create trigger audit_events_no_delete before delete on audit_events
  for each row execute function app.audit_events_immutable();

-- ---------------------------------------------------------------------------
-- Human-friendly references
-- ---------------------------------------------------------------------------

create or replace function app.next_counter(p_business_id uuid, p_key text, p_start bigint) returns bigint
language sql security definer set search_path = public, app as $$
  insert into business_counters (business_id, counter_key, value)
  values (p_business_id, p_key, p_start)
  on conflict (business_id, counter_key) do update set value = business_counters.value + 1
  returning value
$$;

create or replace function app.assign_request_reference() returns trigger
language plpgsql as $$
begin
  if new.reference is null then
    new.reference := 'REQ-' || app.next_counter(new.business_id, 'customer_request', 1001);
  end if;
  return new;
end
$$;
create trigger customer_requests_reference before insert on customer_requests
  for each row execute function app.assign_request_reference();

create or replace function app.assign_ticket_number() returns trigger
language plpgsql as $$
begin
  if new.ticket_number is null then
    new.ticket_number := 'SR-' || app.next_counter(new.business_id, 'service_request', 2001);
  end if;
  return new;
end
$$;
create trigger service_requests_ticket before insert on service_requests
  for each row execute function app.assign_ticket_number();

-- ---------------------------------------------------------------------------
-- Action proposal invariants
-- ---------------------------------------------------------------------------

create or replace function app.has_valid_approval(p_proposal_id uuid, p_version integer, p_hash text) returns boolean
language sql stable as $$
  select exists (
    select 1 from action_approvals a
    where a.proposal_id = p_proposal_id
      and a.decision = 'approved'
      and a.invalidated_at is null
      and a.proposal_version = p_version
      and a.params_hash = p_hash
  )
$$;

create or replace function app.action_proposals_guard() returns trigger
language plpgsql as $$
declare
  new_hash text;
  allowed boolean;
begin
  -- Identity of a proposal can never change.
  if new.business_id <> old.business_id or new.request_id <> old.request_id
     or new.action_type <> old.action_type or new.origin <> old.origin
     or new.original_params <> old.original_params or new.created_at <> old.created_at
     or new.risk_level <> old.risk_level
     or new.ai_run_id is distinct from old.ai_run_id
     or new.created_by is distinct from old.created_by then
    raise exception 'proposal identity fields are immutable' using errcode = 'check_violation';
  end if;

  -- Approval requirements can be tightened but never relaxed.
  if old.requires_approval and not new.requires_approval then
    raise exception 'approval requirement cannot be removed' using errcode = 'check_violation';
  end if;

  if new.params is distinct from old.params then
    if old.status in ('executing', 'executed', 'rejected', 'cancelled') then
      raise exception 'proposal in status % cannot be edited', old.status using errcode = 'check_violation';
    end if;
    -- A parameter change produces a new version and voids prior approvals.
    new.version := old.version + 1;
    new.status := 'draft';
    new.submitted_at := null;
    new.submitted_by := null;
    update action_approvals
      set invalidated_at = now(), invalidation_reason = 'parameters_changed'
      where proposal_id = old.id and invalidated_at is null;
    return new;
  end if;

  if new.version <> old.version then
    raise exception 'proposal version is managed by the database' using errcode = 'check_violation';
  end if;

  if new.status <> old.status then
    allowed := case old.status
      when 'draft' then new.status in ('pending_approval', 'executing', 'rejected', 'cancelled')
      when 'pending_approval' then new.status in ('approved', 'rejected', 'draft', 'cancelled')
      when 'approved' then new.status in ('executing', 'rejected', 'cancelled')
      when 'failed' then new.status in ('executing', 'cancelled', 'draft')
      when 'executing' then new.status in ('executed', 'failed')
      else false
    end;
    if not allowed then
      raise exception 'invalid proposal transition % -> %', old.status, new.status using errcode = 'check_violation';
    end if;

    new_hash := app.params_hash(new.params);

    if new.status = 'pending_approval' and not new.requires_approval then
      raise exception 'proposal does not require approval' using errcode = 'check_violation';
    end if;

    if new.status = 'approved' and not app.has_valid_approval(new.id, new.version, new_hash) then
      raise exception 'no valid approval for this proposal version' using errcode = 'check_violation';
    end if;

    if new.status = 'executing' and new.requires_approval
       and not app.has_valid_approval(new.id, new.version, new_hash) then
      raise exception 'execution requires a valid approval bound to these parameters' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

create trigger action_proposals_guard before update on action_proposals
  for each row execute function app.action_proposals_guard();

create or replace function app.action_proposals_record_revision() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.version <> 1 or new.status <> 'draft' then
      raise exception 'new proposals start as draft version 1' using errcode = 'check_violation';
    end if;
    insert into action_proposal_revisions (business_id, proposal_id, version, params, params_hash, edited_by)
    values (new.business_id, new.id, new.version, new.params, new.params_hash, new.created_by);
  elsif new.params is distinct from old.params then
    insert into action_proposal_revisions (business_id, proposal_id, version, params, params_hash, edited_by)
    values (new.business_id, new.id, new.version, new.params, new.params_hash, new.last_edited_by);
  end if;
  return null;
end
$$;

create trigger action_proposals_revision after insert or update on action_proposals
  for each row execute function app.action_proposals_record_revision();

-- Approvals: only active owners may decide, and a decision must refer to the
-- proposal's current version and exact parameter hash.
create or replace function app.action_approvals_guard() returns trigger
language plpgsql as $$
declare
  p action_proposals%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.proposal_id <> old.proposal_id or new.proposal_version <> old.proposal_version
       or new.params_hash <> old.params_hash or new.decision <> old.decision
       or new.decided_by <> old.decided_by or new.created_at <> old.created_at
       or new.comment is distinct from old.comment
       or old.invalidated_at is not null then
      raise exception 'approval decisions are immutable' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select * into p from action_proposals where id = new.proposal_id for update;
  if not found or p.business_id <> new.business_id then
    raise exception 'proposal not found' using errcode = 'foreign_key_violation';
  end if;

  if not exists (
    select 1 from business_memberships m join profiles pr on pr.id = m.user_id
    where m.business_id = new.business_id and m.user_id = new.decided_by
      and m.role = 'owner' and m.status = 'active' and pr.is_active
  ) then
    raise exception 'only an active owner can decide on proposals' using errcode = 'insufficient_privilege';
  end if;

  if new.proposal_version <> p.version or new.params_hash <> p.params_hash then
    raise exception 'approval does not match the current proposal parameters' using errcode = 'check_violation';
  end if;

  if new.decision = 'approved' and p.status <> 'pending_approval' then
    raise exception 'only proposals pending approval can be approved' using errcode = 'check_violation';
  end if;
  if new.decision = 'rejected' and p.status not in ('draft', 'pending_approval', 'approved') then
    raise exception 'proposal can no longer be rejected' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger action_approvals_guard before insert or update on action_approvals
  for each row execute function app.action_approvals_guard();

-- ---------------------------------------------------------------------------
-- Authentication entry points (SECURITY DEFINER, minimal surface)
-- ---------------------------------------------------------------------------

create or replace function app.auth_lookup_credentials(p_email text)
returns table (user_id uuid, password_hash text, is_active boolean)
language sql stable security definer set search_path = public, app as $$
  select p.id, c.password_hash, p.is_active
  from profiles p join auth_credentials c on c.user_id = p.id
  where lower(p.email) = lower(p_email)
$$;

create or replace function app.auth_create_session(
  p_user_id uuid, p_token_hash text, p_expires_at timestamptz, p_user_agent text, p_ip_hash text
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  sid uuid;
  first_business uuid;
begin
  select m.business_id into first_business
  from business_memberships m join businesses b on b.id = m.business_id
  where m.user_id = p_user_id and m.status = 'active'
  order by (m.role = 'owner') desc, b.name
  limit 1;

  insert into auth_sessions (user_id, token_hash, active_business_id, expires_at, user_agent, ip_hash)
  values (p_user_id, p_token_hash, first_business, p_expires_at, left(p_user_agent, 300), p_ip_hash)
  returning id into sid;
  return sid;
end
$$;

create or replace function app.auth_resolve_session(p_token_hash text)
returns table (session_id uuid, user_id uuid, email text, full_name text, active_business_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = public, app as $$
begin
  update auth_sessions s set last_seen_at = now()
  where s.token_hash = p_token_hash and s.last_seen_at < now() - interval '5 minutes'
    and s.revoked_at is null and s.expires_at > now();

  return query
  select s.id, p.id, p.email, p.full_name, s.active_business_id, s.expires_at
  from auth_sessions s join profiles p on p.id = s.user_id
  where s.token_hash = p_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
    and p.is_active;
end
$$;

create or replace function app.auth_revoke_session(p_token_hash text) returns void
language sql security definer set search_path = public, app as $$
  update auth_sessions set revoked_at = now() where token_hash = p_token_hash and revoked_at is null
$$;

create or replace function app.auth_set_active_business(p_token_hash text, p_business_id uuid) returns boolean
language plpgsql security definer set search_path = public, app as $$
declare
  ok boolean;
begin
  update auth_sessions s set active_business_id = p_business_id
  where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
    and exists (
      select 1 from business_memberships m
      where m.user_id = s.user_id and m.business_id = p_business_id and m.status = 'active'
    );
  get diagnostics ok = row_count;
  return ok;
end
$$;

-- Owners add team members. Runs with the caller's tenant context and checks
-- the caller's role inside the database.
create or replace function app.admin_add_member(
  p_email text, p_full_name text, p_password_hash text, p_role text, p_title text
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  b uuid := app.current_business_id();
  uid uuid;
begin
  if b is null or app.actor() <> 'user' or app.current_member_role() <> 'owner' then
    raise exception 'only an owner can add members' using errcode = 'insufficient_privilege';
  end if;
  if p_role not in ('owner', 'member') then
    raise exception 'invalid role' using errcode = 'check_violation';
  end if;

  select id into uid from profiles where lower(email) = lower(p_email);
  if uid is null then
    insert into profiles (email, full_name) values (lower(p_email), p_full_name) returning id into uid;
    insert into auth_credentials (user_id, password_hash) values (uid, p_password_hash);
  end if;

  insert into business_memberships (business_id, user_id, role, title)
  values (b, uid, p_role, p_title);
  return uid;
end
$$;

-- Public intake: resolve a business slug only if public intake is enabled.
create or replace function app.resolve_public_business(p_slug text)
returns table (business_id uuid, business_name text)
language sql stable security definer set search_path = public, app as $$
  select b.id, b.name from businesses b
  where b.slug = p_slug and coalesce((b.settings ->> 'public_intake_enabled')::boolean, false)
$$;

-- API intake: resolve an API key hash to its business.
create or replace function app.resolve_intake_api_key(p_secret_hash text) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  b uuid;
begin
  update integration_settings set last_used_at = now()
  where secret_hash = p_secret_hash and kind = 'intake_api_key' and is_enabled and revoked_at is null
  returning business_id into b;
  return b;
end
$$;

-- Fixed-window rate limiting shared across application instances.
create or replace function app.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, hits integer, reset_at timestamptz)
language plpgsql security definer set search_path = public, app as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into rate_limit_counters (bucket_key, window_start, hits)
  values (left(p_key, 200), w, 1)
  on conflict (bucket_key, window_start) do update set hits = rate_limit_counters.hits + 1
  returning rate_limit_counters.hits into n;

  if random() < 0.01 then
    delete from rate_limit_counters where window_start < now() - interval '1 day';
  end if;

  return query select n <= p_limit, n, w + make_interval(secs => p_window_seconds);
end
$$;

-- Scheduler: list business ids so the cron route can run each tenant's
-- unresolved check under that tenant's own system context.
create or replace function app.list_business_ids_for_scheduler() returns setof uuid
language sql stable security definer set search_path = public, app as $$
  select id from businesses order by created_at
$$;
