# Architecture

RelayOps is a single Next.js (App Router) application backed by PostgreSQL. Everything that touches data, AI, permissions or execution runs server-side. Client components are limited to forms, dialogs and charts.

```
Browser ──► Next.js proxy (CSP nonce, security headers, signed-out redirect; no authorization)
              │
              ├─ Server components (pages)        ─┐
              ├─ Server actions (src/app/actions)  ├─► server modules (src/server/*) ─► Postgres as relayops_app (RLS)
              └─ Route handlers (src/app/api)     ─┘                │
                                                                    ├─► AI provider (mock | Anthropic | OpenAI-compatible)
                                                                    └─► Delivery adapter (simulated)
```

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/server/auth/` | Password hashing, sessions, `UserContext`, the permission table (`permissions.ts`) |
| `src/server/db/` | Connection pool and `withTenant()`, which opens a transaction and sets the RLS context |
| `src/server/intake/` | `createRequest()`, the single entry point for every channel (manual, demo, public form, API); channel authentication; demo scenarios |
| `src/server/ai/` | `AIService` interface, providers, prompts, Zod output schemas, guards (injection signals, fencing, truncation, grounding check), and the processing `pipeline` |
| `src/server/retrieval/` | `RetrievalService`: deterministic, tenant-scoped record lookup |
| `src/server/records/` | Deterministic business policy (return windows, stock labels, allowed status transitions) |
| `src/server/actions/` | Action registry (schemas + risk), proposal lifecycle, approval, and the execution service and handlers |
| `src/server/rules/` | Workflow rule schema, validation and the deterministic engine |
| `src/server/delivery/` | `DeliveryProvider` interface and the simulated adapter |
| `src/server/audit/` | `recordAudit()`, the metadata sanitizer, audit queries |
| `src/server/metrics/` | Dashboard metrics (measured vs estimated) |
| `src/app/(app)/` | Authenticated pages: dashboard, requests, request detail, approvals, records, rules, audit, settings |
| `db/migrations/` | Version-controlled SQL: schema, functions and triggers, RLS and grants |
| `db/seed/` | Fictional Summit Cycles and Harbor Kayak data, plus a scripted demo workflow |

Server-only modules import `server-only`, so they cannot be bundled into client code.

## Request lifecycle

```
new ──► processing ──► needs_review ──► awaiting_approval ──► approved ──► completed
  │          │               │                                              ▲
  │          └──► failed     └──► (manual actions) ─────────────────────────┘
  └──► rejected (at any open stage)
```

Request status is derived by `src/server/requests/status.ts` from the proposals' states and from explicit staff transitions. Allowed manual transitions are a fixed table in `records/policy-rules.ts`.

## AI processing pipeline

`processRequest()` (`src/server/ai/pipeline.ts`) runs these steps, each recorded in `ai_runs` and the audit log:

1. **Validate and lock.** Load the request under the tenant context; refuse if it is already processing (prevents double runs); check the per-business hourly AI quota.
2. **Minimal context.** Only the request, the business's configured categories, and later the retrieved records. Customer text is truncated to `AI_MAX_INPUT_CHARS`.
3. **Classify** → `classificationOutputSchema` (category from the configured list, extracted fields, uncertainty, missing information, injection flag, suggested next step).
4. **Summarize** → `summaryOutputSchema`.
5. **Retrieve** → `RetrievalService.retrieve()`. Plain SQL under RLS: exact order and ticket lookups only for the matched customer, product full-text + trigram search, inventory, open appointment slots, and the policies relevant to the category.
6. **Draft a response** → `draftOutputSchema`. Every claim is tagged `record` / `customer` / `assumption` / `unavailable`, with evidence references.
7. **Propose actions** → `proposalOutputSchema`, a discriminated union over the seven action types.
8. **Validate.** Zod strict schemas, then `checkGrounding()` (amounts, order numbers, tracking numbers, dates and stock claims in a draft must appear in the retrieved evidence), then the action registry and `validateActionContext()` (referenced IDs must exist in this business and belong to this customer).
9. **Persist** the classification (`request_classifications`, with provider, model, prompt version and token usage) and the proposals (`action_proposals`, origin `ai`). Refused suggestions are audited as `proposal.blocked_by_policy` or `ai.output_rejected`; they are not saved as proposals.
10. **Present.** The request moves to `needs_review`, and workflow rules for `request.classified` and `proposal.created` run.

If the provider fails (timeout, outage, malformed output after retries), the run is recorded as failed, the request stays usable, and staff continue with manual actions. Nothing in the product depends on the AI being available.

### Provider abstraction

`AIService` (`src/server/ai/service.ts`) has one method per task: `classify`, `summarize`, `draftResponse`, `proposeActions`. Retrieval is a separate `RetrievalService`, so the model never queries data itself. Implementations:

- `MockAIService`: deterministic and keyword-based. Default for development and tests.
- `UnavailableAIService`: always fails, for exercising the manual path.
- `LlmAIService` over a `JsonTransport`: `AnthropicTransport` (Messages API with a forced tool call) or `OpenAITransport` (Chat Completions with JSON mode, any compatible base URL). The shared HTTP helper applies `AI_TIMEOUT_MS`, retries only transient failures (429/5xx/network) up to `AI_MAX_RETRIES` with backoff, and never retries 4xx.

All provider output is `unknown` until the server parses it.

## Action proposals, approval and execution

See [action-risk-policy.md](action-risk-policy.md) for the policy itself. Mechanically:

- `action_proposals` holds the current `params` (normalized JSON), `original_params` (as first proposed, immutable), `params_hash` (SHA-256 of canonical JSON, computed by `app.params_hash()`), `version`, `risk_level`, `requires_approval` and `status`.
- `action_proposal_revisions` gets a row for every version (insert-only). User edits are therefore stored separately from the model's original output.
- `action_approvals` records each decision with the `proposal_version` and `params_hash` it applies to. Rows are insert-only, except for setting `invalidated_at`.
- The `action_proposals_guard` trigger enforces:
  - identity fields (business, request, type, origin, original params, risk) never change;
  - `requires_approval` can go from false to true, never back;
  - any change to `params` bumps the version, resets the status to `draft`, and invalidates all live approvals;
  - status transitions follow a fixed state machine;
  - `approved` and `executing` (for approval-required actions) are refused unless `app.has_valid_approval(id, version, hash)` is true.
- `executeProposal()` locks the row `FOR UPDATE`, re-checks permission, status and expected version, re-validates the parameters against the schema and current records (e.g. the appointment slot is still free), moves to `executing` (trigger check), runs exactly one handler, and writes `executed` + `workflow_executions` + audit events in the same transaction. A unique partial index on `workflow_executions (proposal_id) where status = 'succeeded'` is a final guard against double execution. On failure the transaction rolls back and the failure is recorded in a separate transaction (`failed`, retryable).

## Workflow rules

Rules (`workflow_rules`) have a name, description, enabled flag, trigger, up to five conditions (`field op value`) and one action. They are validated by a Zod schema that restricts which fields and actions are allowed per trigger.

| Trigger | Allowed actions |
| --- | --- |
| `request.created` | process with AI, assign, set priority |
| `request.classified` | assign, set priority, require human review |
| `request.unresolved_check` | flag unresolved after N hours |
| `proposal.created` | require approval for given action types |

Rules can only make things stricter: they can add an approval requirement or force human review, never remove one. Each application is logged in `workflow_executions` and the audit log. The unresolved check runs from the dashboard button or from `/api/cron/unresolved` (bearer `CRON_SECRET`).

## Authentication

App-managed, to keep the system self-contained:

- Passwords are hashed with scrypt (random salt, constant-time compare) in `auth_credentials`. The runtime role cannot read that table; login goes through the `SECURITY DEFINER` function `app.auth_lookup_credentials`.
- Sessions are random 32-byte tokens. Only an HMAC-SHA256 of the token (keyed with `AUTH_SECRET`) is stored in `auth_sessions`. Resolution, creation, revocation and switching the active business all go through narrow `SECURITY DEFINER` functions.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` and `__Host-` prefix when `APP_URL` is HTTPS; TTL `SESSION_TTL_HOURS`.
- Login attempts are rate limited per IP and per email, and failures return a generic message.
- `requireUser()` resolves the session on every request. The active business comes from the session row, never from the URL or a form field.

To use **Supabase Auth** instead: replace `session-service.ts` / `context.ts` with `@supabase/ssr`'s server client, map the verified Supabase user to a `profiles` row, and keep calling `withTenant()` with that user ID. The RLS policies key on `app.current_user_id()` and need no change.

## Database schema

All business-owned tables carry `business_id` with a foreign key, and child tables use composite foreign keys `(business_id, id)`, so a row can never reference another tenant's row. Keys are UUIDs, timestamps are `timestamptz`, and enumerations are `check` constraints.

| Table | Purpose |
| --- | --- |
| `businesses` | Tenant: name, slug, timezone, support email, settings JSON (time-saved minutes, demo flag) |
| `profiles` | People (one per login) |
| `auth_credentials`, `auth_sessions` | Password hashes and hashed session tokens (not readable by the runtime role) |
| `business_memberships` | User ↔ business with `role` (`owner` / `member`) and `status` |
| `customers` | Customer records (unique email per business) |
| `products`, `inventory_records` | Catalogue with a generated `search_vector` and trigram index; stock per location |
| `orders`, `order_items` | Orders with status, fulfilment, carrier, tracking, delivered date |
| `service_requests` | Workshop tickets (auto-numbered) |
| `appointments` | Service slots: `available` slots are open capacity, `booked` ones belong to a customer |
| `refund_requests` | Drafts for human handling; no payment fields |
| `business_policies` | Policies and FAQs, keyed and categorized, full-text indexed |
| `request_categories` | Configurable categories with manual and assisted minutes for the time-saved estimate |
| `customer_requests` | Incoming requests: channel, customer link, status, priority, assignee, AI status, flags, `REQ-` reference |
| `ai_runs` | One row per AI task call: provider, model, prompt version, status, error code, latency, token usage (no prompt text) |
| `request_classifications` | AI output and staff corrections as separate rows (`source = ai / human`), `is_current` flag |
| `retrieved_records` | Evidence shown to the AI for a request, with reference keys used in citations |
| `internal_notes` | Staff and rule notes |
| `action_proposals`, `action_proposal_revisions`, `action_approvals` | See above |
| `workflow_rules`, `workflow_executions` | Rules; every rule application and every action execution (with idempotency key) |
| `message_deliveries` | Messages recorded by the delivery adapter (`simulated = true`) |
| `audit_events` | Append-only event log |
| `integration_settings` | Intake API keys (hashed), public-form toggle |
| `rate_limit_counters`, `business_counters` | Fixed-window rate limiting; per-business reference sequences |

Indexes cover every foreign key used in joins, inbox filters (`business_id, status, created_at`), assignee, category, audit lookups, and full-text and trigram search.

## Authorization rules

Authorization happens in two independent layers:

**1. Application (`src/server/auth/permissions.ts`).** One table maps permissions to roles, and every server action and service function calls `assertCan()`. The UI uses the same table only to hide controls.

| Capability | Owner | Member |
| --- | :-: | :-: |
| View all requests | ✓ | assigned to them or unassigned |
| Create, process, correct classification | ✓ | ✓ |
| Create, edit, submit, dismiss proposals | ✓ | ✓ |
| Execute medium-risk proposals | ✓ | ✓ |
| Execute approved high-risk proposals | ✓ | ✓ (only once an owner has approved) |
| **Approve / reject** | ✓ | ✗ |
| Update operational records (ticket status, slots) | ✓ | ✓ |
| Manage catalogue and policies, rules, team, settings, API keys | ✓ | ✗ |
| Full audit log | ✓ | events they performed or on requests they can see |

**2. Database (RLS, `db/migrations/0003_rls_and_grants.sql`).** The web app connects as `relayops_app` (`NOSUPERUSER NOBYPASSRLS`, owns no tables). `withTenant()` sets `app.actor`, `app.user_id` and `app.business_id` as transaction-local settings. `app.current_business_id()` returns the business only if the user has an active membership, so a forged business ID yields no rows. Policies:

- Every business table: `business_id = app.current_business_id()`.
- `customer_requests` (and records hanging off a request): members additionally need `assigned_to` to be null or themselves (`app.can_view_assignment`).
- `action_approvals` insert: only owners, and `decided_by` must be the current user.
- `audit_events`: insert and select only. A trigger refuses update and delete for every role, including the owner.
- `auth_*`, `rate_limit_counters`, `business_counters`: no direct grants; access is through `SECURITY DEFINER` functions only.
- Column-level grants limit what can be updated (e.g. only `name, timezone, support_email, settings` on `businesses`).

Background work (scheduled unresolved check, public form, API intake) runs as a `system` actor with a business resolved on the server (from the API key hash or the public slug). It can create requests and run rules, but it has no user identity, so it can never approve or execute.

## Intake API

```http
POST /api/v1/requests
Authorization: Bearer ro_live_<key>
Content-Type: application/json

{
  "customer_name": "Avery Stone",
  "customer_email": "avery@example.com",
  "subject": "Do you have the Ridgeline Trail 29 in medium?",
  "body": "Looking to buy this weekend.",
  "external_ref": "form-1234",
  "idempotency_key": "form-1234"
}
```

- The key (created by an owner in Settings; only its hash is stored) determines the business. A `business_id` field is rejected as an unknown field.
- Strict schema, 32 KB body limit, per-business rate limit, and `idempotency_key` deduplication.
- Returns `201 { id, reference, status }`. If the "Classify new requests with AI" rule is on, AI processing runs after the response.

The public form (`/intake/<slug>`) calls the same `createRequest()`, with a honeypot field and per-IP rate limiting.

## Extension points

| To add | Implement |
| --- | --- |
| Real email delivery | A `DeliveryProvider` (e.g. Postmark, SES) and a new `DELIVERY_PROVIDER` value. The approval flow stays the same. |
| Gmail / helpdesk / form integrations | Call `POST /api/v1/requests` or `createRequest()` with a new channel value |
| Shopify / POS order sync | A sync job writing into `orders`/`products` as the owner role, or a new `RetrievalService` that queries the external system |
| Semantic search | A `RetrievalService` returning `EvidenceItem`s (e.g. pgvector), selected in `getRetrievalService()` |
| Another AI provider | A `JsonTransport` |
| Supabase Auth, SSO, MFA | Replace the session service (see Authentication) |
| More roles | Extend the `role` check constraint, `PERMISSIONS`, and the relevant RLS helpers |
