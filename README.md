# RelayOps

AI-assisted operations for small businesses. RelayOps takes in customer requests, classifies and summarizes them with an AI model, retrieves the relevant business records, and proposes typed actions, such as a reply, a service ticket, an appointment or a refund request. People then review, approve and execute those proposals through a controlled service, and every step is recorded in an append-only audit log.

The demo business is **Summit Cycles**, a fictional bicycle shop. A second fictional tenant, Harbor Kayak Co., exists to demonstrate tenant isolation. **All data is fictional, and customer messages are delivered by a simulated adapter. Nothing is emailed.**

> RelayOps is not an autonomous agent. The model can only *propose* one of seven fixed, schema-validated action types. Application code decides risk and permissions; a person executes. High-risk actions also need an owner's approval, and that approval is bound to the exact parameter values.

---

## Contents

- [Quick start](#quick-start)
- [Demo walkthrough](#demo-walkthrough)
- [Commands](#commands)
- [Configuration](#configuration)
- [What is real and what is simulated](#what-is-real-and-what-is-simulated)
- [Security boundaries](#security-boundaries)
- [Testing](#testing)
- [Deployment](#deployment)
- [Known limitations](#known-limitations)
- Further documentation: [architecture and schema](docs/architecture.md), [action risk and approval policy](docs/action-risk-policy.md), [security model and remaining risks](docs/security.md), [deployment](docs/deployment.md), [testing](docs/testing.md)

---

## Quick start

Requirements: **Node.js 22.12+** and **PostgreSQL 15+** (16 is used in development) with the `pg_trgm` extension available. No AI credentials are needed; the default provider is a deterministic mock.

```bash
npm install
cp .env.example .env.local      # adjust the connection URLs if your Postgres differs
npm run db:setup                # creates roles relayops_owner / relayops_app and the dev + test databases
npm run db:migrate              # applies db/migrations/*.sql
npm run db:seed                 # loads Summit Cycles demo data and runs part of the demo workflow
npm run dev                     # http://localhost:3000
```

`db:setup` connects with `PG_SUPERUSER_URL` (default `postgres://postgres:postgres@localhost:5432/postgres`) to create the two roles and databases and to install `pg_trgm`. Run it once.

**Reset the development environment** at any time (drop everything, migrate, reseed):

```bash
npm run db:reset
```

### Demo accounts

All accounts use the password `relayops-demo-2026`. The login page has one-click buttons that fill these in.

| Email | Role | Business |
| --- | --- | --- |
| owner@summitcycles.example | Owner (Maya Chen) | Summit Cycles |
| service@summitcycles.example | Member (Jordan Reyes, service lead) | Summit Cycles |
| frontdesk@summitcycles.example | Member (Priya Patel, front desk) | Summit Cycles |
| owner@harborkayak.example | Owner (Sam Okafor) | Harbor Kayak Co. (second tenant) |

---

## Demo walkthrough

The seed creates 20 requests across every status, including a malicious prompt-injection message (REQ-1012), an ambiguous "is it ready" (REQ-1011), a failed execution (REQ-1009), and requests awaiting approval (REQ-1007, REQ-1008).

A full process → propose → approve → execute → audit loop:

1. Sign in as **Priya** (member). Open **Requests → New request**. Enter `Alex Morgan`, `alex.morgan@example.com`, subject `Where is my order?`, message `Order SC-10421, when will it arrive?`. Leave **Classify and draft with AI** checked and create it.
2. On the request page, compare the **Original message** with the **AI interpretation** (category *Order status*, uncertainty, extracted order number). **Business records found** shows the persisted order, customer and shipping policy that were retrieved. Every claim in the draft is labelled *confirmed by records*, *supplied by the customer*, *assumption* or *not available*.
3. The **Send customer response** proposal shows the exact recipient, subject and body, plus the parameter hash the approval will be bound to. Edit it if you like: the original AI version is kept and the edit becomes version 2. Click **Send for approval**. As a member, Priya cannot approve.
4. Sign out and sign in as **Maya** (owner). **Approvals** lists the pending proposal. Open it, choose **Review and decide**, check the values and choose **Approve and execute**.
5. The message appears under **Messages**, labelled *Simulated*. The request is completed, and the **Activity** timeline (and the business-wide **Audit log**) shows each step: received, AI started and finished, records retrieved, proposed, submitted, approved for version *n*, execution started, simulated delivery, executed, status changed.

Other things to try:

- **REQ-1012 (prompt injection).** The message tells the AI to approve a $5,000 refund, grant admin access and email the customer list. The request is flagged, the unsupported actions are refused by policy (and audited), and nothing can execute without a person.
- **Edit an approved proposal.** The approval is invalidated immediately; the proposal returns to draft and needs a new approval.
- **Set `AI_PROVIDER=unavailable`** and restart. Processing fails gracefully, and every manual workflow (New action, edit, approve, execute) still works.
- **Sign in as Sam (Harbor Kayak).** None of Summit Cycles' data is visible, and pasting a Summit request URL returns not found.
- **Workflow rules** (owner): toggle or edit the seeded rules, e.g. routing service requests to Jordan, or requiring approval for status changes on returns.
- **Settings → Integrations** (owner): create an intake API key and post to `/api/v1/requests` (see [Intake API](docs/architecture.md#intake-api)). The public intake form lives at `/intake/summit-cycles`.

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Next route type generation + `tsc --noEmit` (strict) |
| `npm test` | All Vitest suites (unit + integration; integration uses the test database) |
| `npm run test:unit` / `npm run test:integration` | One suite |
| `npm run test:e2e` | Playwright end-to-end tests (starts its own dev server on port 3100 against the test database) |
| `npm run check` | lint + typecheck + tests + build |
| `npm run db:setup` / `db:migrate` / `db:seed` / `db:reset` | Database tooling |

---

## Configuration

All configuration is via environment variables, validated at startup by `src/server/env.ts`. See [`.env.example`](.env.example) for the full list.

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Runtime connection as **`relayops_app`**, a `NOSUPERUSER NOBYPASSRLS` role that owns nothing. Row-level security applies to every query. |
| `DATABASE_ADMIN_URL` | Schema owner (`relayops_owner`). Used only by migrations and seeds, never by the web app. |
| `TEST_DATABASE_URL`, `TEST_DATABASE_ADMIN_URL` | A **separate** database for automated tests; it is wiped on every run. The test helpers refuse to run if it is the same database as `DATABASE_URL`. |
| `AUTH_SECRET` | 32+ characters. Production refuses the development placeholder. Generate one with `openssl rand -base64 48`. |
| `APP_URL` | Public base URL. When it is `https://`, cookies use the `__Host-` prefix and `Secure`. |
| `AI_PROVIDER` | `mock` (default), `anthropic`, `openai` (any OpenAI-compatible endpoint), or `unavailable` (simulates an outage). |
| `AI_MODEL` | Optional for Anthropic (default `claude-sonnet-5-5`), required for OpenAI-compatible providers. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENAI_BASE_URL` | Server-only. Never sent to the browser or written to logs or audit metadata. |
| `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`, `AI_MAX_INPUT_CHARS`, `AI_RUNS_PER_HOUR` | Per-call timeout, transient-failure retries, input truncation limit, per-business hourly AI quota. |
| `AI_LOG_PROMPTS` | `false` by default. Full prompts and customer messages are not logged unless you turn this on for local debugging. |
| `PUBLIC_INTAKE_PER_HOUR`, `API_INTAKE_PER_MINUTE`, `LOGIN_ATTEMPTS_PER_15_MIN` | Rate limits, stored in Postgres so they hold across serverless instances. |
| `CRON_SECRET` | Bearer secret for `/api/cron/unresolved`. If unset, the route is disabled. |

### Using a real AI provider

```bash
# Anthropic
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
# AI_MODEL=claude-sonnet-5-5

# Or any OpenAI-compatible endpoint
AI_PROVIDER=openai
OPENAI_API_KEY=...
AI_MODEL=<model name>
# OPENAI_BASE_URL=https://api.openai.com/v1
```

Hosted providers are called over HTTPS with a forced tool call (Anthropic) or JSON mode (OpenAI-compatible). Every response is parsed with the same Zod schemas and grounding checks as the mock provider. **The hosted adapters are covered by tests that use simulated HTTP responses. They have not been exercised against a live API in this environment, because no credentials were available.**

---

## What is real and what is simulated

| Area | Status |
| --- | --- |
| Database persistence, RLS, triggers, retrieval (Postgres full-text + trigram search) | **Real** |
| Authentication (password + server-side sessions), roles, tenant isolation | **Real** (app-managed; see [the note on Supabase Auth](#note-on-supabase)) |
| Workflow rules, approvals, execution, audit log, metrics | **Real** |
| Service tickets, appointment bookings, internal notes, status and assignment changes | **Real** changes to RelayOps' own records |
| Refund requests | **Draft only.** `prepare_refund_request` creates a refund record for a person to handle. No money moves; there is no payment integration. |
| Customer messages | **Simulated.** Recorded by the mock delivery adapter, and labelled *Simulated* everywhere they appear. No email is sent. |
| AI: mock provider | **Real** and deterministic, used by default and in tests |
| AI: Anthropic / OpenAI-compatible adapters | Implemented; **not verified against a live API** here |
| Intake API and public form | **Real** endpoints. No Gmail, Shopify, POS or CRM integration exists. |

<a id="note-on-supabase"></a>
### Note on Supabase

The brief asked for Supabase PostgreSQL and Supabase Auth. The schema is plain PostgreSQL and runs on Supabase Postgres unchanged (see [deployment](docs/deployment.md)). **Authentication is not Supabase Auth.** It is a small app-managed implementation instead: scrypt password hashes and random session tokens that are stored only as keyed HMAC-SHA256 hashes, resolved through `SECURITY DEFINER` functions, and kept in `HttpOnly`, `SameSite=Lax` cookies. This kept the whole system runnable and testable locally without a hosted Supabase project. RLS keys on a transaction-local `app.user_id` that the server sets from the verified session, not on `auth.uid()`. Moving to Supabase Auth means swapping `src/server/auth/session-service.ts` for Supabase's server client and setting `app.user_id` from the verified Supabase user. The policies do not change. See [architecture](docs/architecture.md#authentication).

---

## Security boundaries

The short version (details in [docs/security.md](docs/security.md)):

- **The model proposes; it cannot act.** AI output is parsed into one of seven action types with strict Zod schemas (unknown types and fields are rejected). The AI pipeline has no code path to the execution service, and the execution service refuses non-user actors.
- **Risk is defined in code** (`src/server/actions/registry.ts`), never taken from model output. Workflow rules can add approval requirements, but neither rules nor anything else can remove one; a database trigger enforces this.
- **Approval is bound to exact values.** Approvals record the proposal version and a SHA-256 hash of the canonical parameters. Any parameter change bumps the version and invalidates existing approvals, in a database trigger, so no code path can skip it. The move to `executing` is refused by the database unless a valid matching approval exists.
- **Exactly-once execution.** The proposal row is locked `FOR UPDATE`; the status machine is enforced by a trigger; a unique index allows one successful execution per proposal. The handler's effects, the status change, the execution record and the audit event commit in one transaction.
- **Tenant isolation in the database.** The runtime role is subject to RLS on every table. The business ID comes from the server-side session and is honoured only if the user is an active member. Members see only requests assigned to them or unassigned.
- **Prompt injection is treated as a security issue.** Customer text is delimited and marked as untrusted, injection signals are flagged to reviewers, drafts are grounding-checked against retrieved records, and a fully hostile provider is tested to be contained.
- **Append-only audit log.** Update and delete are refused by a trigger for every role. Metadata passes through a sanitizer that drops message content, contact details and secrets.

These controls reduce risk; they do not make the system production-secure. See [remaining risks](docs/security.md#remaining-risks).

---

## Testing

```bash
npm run lint && npm run typecheck && npm test && npm run build
npm run test:e2e        # see below for the browser
```

- **Vitest:** 74 tests in 12 files. Unit tests cover the action registry, rule schema, policy rules, guards, sanitizer and providers. Integration tests run against the real Postgres test database with RLS on.
- **Playwright:** 3 tests covering the full workflow through the UI (member submits → AI classifies and drafts → member sends for approval → owner approves the exact version → simulated delivery → state and audit trail verified), the signed-out redirect, and member read-only views.

Playwright uses its own Chromium (`npx playwright install chromium`). In sandboxes with a preinstalled browser, set `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome`.

[docs/testing.md](docs/testing.md) maps each of the 26 required scenarios to the test that covers it.

---

## Deployment

The app targets Vercel (Node.js runtime) with a managed Postgres such as Supabase. Summary:

1. Create the database, then create the two roles and install `pg_trgm` (SQL in [docs/deployment.md](docs/deployment.md)).
2. Run `npm run db:migrate` against it with `DATABASE_ADMIN_URL` set to the owner role. Optionally run `npm run db:seed` for the demo data.
3. In Vercel, set `DATABASE_URL` (runtime role), `AUTH_SECRET`, `APP_URL`, `AI_PROVIDER` (+ key), and `CRON_SECRET`. Do **not** set `DATABASE_ADMIN_URL` in the web app's environment.
4. Deploy. Check `GET /api/health` returns `{"status":"ok"}`.

`vercel.json` schedules the unresolved-request check hourly; Vercel's Hobby plan only allows daily crons, so change the schedule there if needed. **This project has not been deployed to Vercel from this environment.** The production build and `next start` were verified locally.

---

## Known limitations

- Customer delivery is simulated; there is no real email provider yet (the `DeliveryProvider` interface is where it plugs in).
- Auth is app-managed rather than Supabase Auth: no password reset, email verification, MFA or SSO.
- Two roles only (owner, member). There is no per-category permission configuration.
- Hosted AI adapters are untested against live APIs. The mock provider is keyword-based, so it is good for demos and tests but not a real classifier.
- Retrieval is keyword/trigram-based, with no semantic search. The `RetrievalService` interface allows adding it.
- Rate limits are per-key counters in Postgres, which is fine at small scale but not a DDoS defence.
- No real integrations (Gmail, Shopify, POS, CRM). The intake API is the extension point.
- Seeded metrics are demonstration data and are labelled as such. The "time saved" figure is an estimate from configurable per-category minutes, not a measurement.

Future integrations and work are listed in [docs/architecture.md](docs/architecture.md#extension-points).
