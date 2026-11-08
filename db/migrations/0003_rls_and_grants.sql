-- Row-level security and least-privilege grants for the runtime role.
--
-- relayops_app is the only role the web application uses at runtime. It is
-- NOSUPERUSER and NOBYPASSRLS (see scripts/db.ts setup), owns nothing, and
-- receives only the privileges below. Migrations and seeds run as the owner.

-- Wrapping helper calls in (select ...) lets Postgres evaluate them once per
-- statement instead of once per row.

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'businesses', 'profiles', 'business_memberships', 'customers', 'products',
    'inventory_records', 'orders', 'order_items', 'business_policies',
    'request_categories', 'customer_requests', 'ai_runs', 'request_classifications',
    'retrieved_records', 'service_requests', 'appointments', 'refund_requests',
    'internal_notes', 'action_proposals', 'action_proposal_revisions',
    'action_approvals', 'workflow_rules', 'workflow_executions',
    'message_deliveries', 'audit_events', 'integration_settings',
    'auth_credentials', 'auth_sessions', 'rate_limit_counters', 'business_counters'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create policy businesses_select on businesses for select
  using (id = (select app.current_business_id())
         or id in (select m.business_id from business_memberships m
                   where m.user_id = (select app.current_user_id()) and m.status = 'active'));
create policy businesses_update on businesses for update
  using (id = (select app.current_business_id()) and (select app.current_member_role()) = 'owner')
  with check (id = (select app.current_business_id()));

create policy memberships_select on business_memberships for select
  using (business_id = (select app.current_business_id()) or user_id = (select app.current_user_id()));
create policy memberships_update on business_memberships for update
  using (business_id = (select app.current_business_id()) and (select app.current_member_role()) = 'owner')
  with check (business_id = (select app.current_business_id()));

create policy profiles_select on profiles for select
  using (id = (select app.current_user_id())
         or exists (select 1 from business_memberships m
                    where m.user_id = profiles.id and m.business_id = (select app.current_business_id())));
create policy profiles_update_self on profiles for update
  using (id = (select app.current_user_id()))
  with check (id = (select app.current_user_id()));

-- auth_credentials, auth_sessions, rate_limit_counters and business_counters
-- have RLS enabled and no policies: the runtime role cannot read them directly
-- and must use the SECURITY DEFINER functions in 0002.

-- ---------------------------------------------------------------------------
-- Business-scoped tables: same-tenant read/write
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'products', 'inventory_records', 'orders', 'order_items',
    'service_requests', 'appointments', 'refund_requests'
  ] loop
    execute format(
      'create policy %I on %I for all using (business_id = (select app.current_business_id())) with check (business_id = (select app.current_business_id()))',
      t || '_tenant', t);
  end loop;
end
$$;

-- Configuration that only owners may change, but everyone in the business may read.
do $$
declare
  t text;
begin
  foreach t in array array['business_policies', 'request_categories', 'workflow_rules'] loop
    execute format(
      'create policy %I on %I for select using (business_id = (select app.current_business_id()))',
      t || '_select', t);
    execute format(
      'create policy %I on %I for insert with check (business_id = (select app.current_business_id()) and (select app.current_member_role()) = ''owner'')',
      t || '_insert', t);
    execute format(
      'create policy %I on %I for update using (business_id = (select app.current_business_id()) and (select app.current_member_role()) = ''owner'') with check (business_id = (select app.current_business_id()))',
      t || '_update', t);
    execute format(
      'create policy %I on %I for delete using (business_id = (select app.current_business_id()) and (select app.current_member_role()) = ''owner'')',
      t || '_delete', t);
  end loop;
end
$$;

create policy integration_settings_owner on integration_settings for all
  using (business_id = (select app.current_business_id()) and (select app.current_member_role()) = 'owner')
  with check (business_id = (select app.current_business_id()) and (select app.current_member_role()) = 'owner');

-- ---------------------------------------------------------------------------
-- Requests and everything hanging off a request
-- ---------------------------------------------------------------------------

create policy customer_requests_select on customer_requests for select
  using (business_id = (select app.current_business_id()) and app.can_view_assignment(assigned_to));
create policy customer_requests_insert on customer_requests for insert
  with check (business_id = (select app.current_business_id()));
create policy customer_requests_update on customer_requests for update
  using (business_id = (select app.current_business_id()) and app.can_view_assignment(assigned_to))
  with check (business_id = (select app.current_business_id()));

-- Child tables inherit request visibility: the EXISTS subquery is itself
-- filtered by the customer_requests policy above.
do $$
declare
  t text;
begin
  foreach t in array array[
    'ai_runs', 'request_classifications', 'retrieved_records', 'internal_notes',
    'action_proposals', 'message_deliveries'
  ] loop
    execute format(
      'create policy %I on %I for select using (business_id = (select app.current_business_id()) and exists (select 1 from customer_requests r where r.id = %I.request_id))',
      t || '_select', t, t);
    execute format(
      'create policy %I on %I for insert with check (business_id = (select app.current_business_id()) and exists (select 1 from customer_requests r where r.id = %I.request_id))',
      t || '_insert', t, t);
    execute format(
      'create policy %I on %I for update using (business_id = (select app.current_business_id()) and exists (select 1 from customer_requests r where r.id = %I.request_id)) with check (business_id = (select app.current_business_id()))',
      t || '_update', t, t);
  end loop;
end
$$;

create policy proposal_revisions_select on action_proposal_revisions for select
  using (business_id = (select app.current_business_id())
         and exists (select 1 from action_proposals p where p.id = action_proposal_revisions.proposal_id));
create policy proposal_revisions_insert on action_proposal_revisions for insert
  with check (business_id = (select app.current_business_id()));

create policy approvals_select on action_approvals for select
  using (business_id = (select app.current_business_id())
         and exists (select 1 from action_proposals p where p.id = action_approvals.proposal_id));
create policy approvals_insert on action_approvals for insert
  with check (business_id = (select app.current_business_id())
              and decided_by = (select app.current_user_id())
              and (select app.current_member_role()) = 'owner');
create policy approvals_invalidate on action_approvals for update
  using (business_id = (select app.current_business_id()))
  with check (business_id = (select app.current_business_id()));

create policy workflow_executions_select on workflow_executions for select
  using (business_id = (select app.current_business_id())
         and (request_id is null or exists (select 1 from customer_requests r where r.id = workflow_executions.request_id)));
create policy workflow_executions_insert on workflow_executions for insert
  with check (business_id = (select app.current_business_id()));
create policy workflow_executions_update on workflow_executions for update
  using (business_id = (select app.current_business_id()))
  with check (business_id = (select app.current_business_id()));

-- Audit: owners see the whole business log; members see events on requests
-- they can see and events they caused. Nobody can update or delete.
create policy audit_events_select on audit_events for select
  using (business_id = (select app.current_business_id())
         and ((select app.current_member_role()) in ('owner', 'system')
              or actor_user_id = (select app.current_user_id())
              or (request_id is not null and exists (select 1 from customer_requests r where r.id = audit_events.request_id))));
create policy audit_events_insert on audit_events for insert
  with check (business_id = (select app.current_business_id())
              and (actor_user_id is null or actor_user_id = (select app.current_user_id())));

-- ---------------------------------------------------------------------------
-- Grants for the runtime role
-- ---------------------------------------------------------------------------

grant usage on schema public, app to relayops_app;

grant select on businesses, profiles, business_memberships to relayops_app;
grant update (name, timezone, support_email, settings) on businesses to relayops_app;
grant update (role, status, title) on business_memberships to relayops_app;
grant update (full_name) on profiles to relayops_app;

grant select, insert, update on
  customers, products, inventory_records, orders, order_items,
  service_requests, appointments, refund_requests,
  business_policies, request_categories, workflow_rules,
  customer_requests, ai_runs, request_classifications, retrieved_records,
  internal_notes, action_proposals, workflow_executions, message_deliveries,
  integration_settings
to relayops_app;
grant delete on workflow_rules to relayops_app;

grant select, insert on action_proposal_revisions to relayops_app;
grant select, insert on action_approvals to relayops_app;
grant update (invalidated_at, invalidation_reason) on action_approvals to relayops_app;

-- Audit: insert and read only.
grant select, insert on audit_events to relayops_app;

grant execute on all functions in schema app to relayops_app;
