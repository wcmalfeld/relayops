# Deployment

RelayOps is a standard Next.js app on the Node.js runtime with one PostgreSQL database. The steps below target **Vercel + Supabase Postgres**; any Node host and any Postgres 15+ with `pg_trgm` works the same way.

> **Status:** the production build (`next build`) and production server (`next start`) were verified locally against PostgreSQL 16. **No deployment to Vercel or Supabase was performed from the build environment.** Treat these steps as a runbook to verify on first use.

## 1. Database

Create a Postgres database (on Supabase: a new project). Then, as an administrative user (on Supabase: the `postgres` user in the SQL editor), create the two roles and the extension:

```sql
-- Schema owner: used only for migrations and seeds.
create role relayops_owner with login password '<strong-owner-password>' nosuperuser nocreaterole;
-- Runtime role used by the web app. The name must be relayops_app (grants in 0003 reference it).
create role relayops_app with login password '<strong-app-password>'
  nosuperuser nocreatedb nocreaterole nobypassrls noinherit;

grant connect on database postgres to relayops_app;   -- use your database name
grant create, usage on schema public to relayops_owner;
create schema if not exists app authorization relayops_owner;  -- or let migration 0001 create it
create extension if not exists pg_trgm;
```

Notes:

- On Supabase, the `public` schema is exposed through the Data API (PostgREST). RelayOps does not use it. Either disable the Data API for the project, or make sure the `anon` and `authenticated` roles have no privileges on RelayOps tables. The migrations grant nothing to them, and RLS is enabled on every table either way.
- If `create extension` must be run from the dashboard (Database → Extensions), enable `pg_trgm` there.
- If migration 0001 fails because the owner cannot create the `app` schema, create it as shown above.

## 2. Migrate (and optionally seed)

From a machine with the repository:

```bash
export DATABASE_ADMIN_URL='postgres://relayops_owner:<pw>@<host>:5432/<db>?sslmode=require'
export DATABASE_URL='postgres://relayops_app:<pw>@<host>:5432/<db>?sslmode=require'
npm ci
npm run db:migrate
# Demo only. Creates users with a PUBLIC password; never do this for real customers.
# npm run db:seed
```

Use the **direct** (or session-mode) connection string for migrations. Each migration runs in one transaction.

For a real business (not the demo), create the business, the first owner and categories with a small script modelled on `seedReferenceData()` in `db/seed/seed.ts` (business, profile, credential, membership and category inserts), run as the owner role.

## 3. Configure the app

Set these environment variables in Vercel (Project → Settings → Environment Variables):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `relayops_app` connection string. On Supabase the **transaction pooler** (port 6543) works: RelayOps sets its RLS context with transaction-local `set_config(..., true)` inside explicit transactions and uses only unnamed statements, which transaction-mode poolers support. |
| `DATABASE_POOL_MAX` | Small, e.g. `3`, since each serverless instance has its own pool |
| `AUTH_SECRET` | `openssl rand -base64 48` |
| `APP_URL` | `https://your-domain` (enables `__Host-` secure cookies and `upgrade-insecure-requests`) |
| `AI_PROVIDER` | `anthropic` or `openai`, or `mock` for a demo |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (+ `AI_MODEL`, `OPENAI_BASE_URL`) | As needed |
| `CRON_SECRET` | 24+ random characters. Vercel Cron sends it as `Authorization: Bearer …` |
| Optional | `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`, `AI_RUNS_PER_HOUR`, `PUBLIC_INTAKE_PER_HOUR`, `API_INTAKE_PER_MINUTE`, `LOGIN_ATTEMPTS_PER_15_MIN`, `SESSION_TTL_HOURS` |

Do **not** set `DATABASE_ADMIN_URL`, `PG_SUPERUSER_URL` or the `TEST_*` variables in the web app's environment.

## 4. Deploy

```bash
npm i -g vercel
vercel link
vercel deploy --prod
```

Or connect the Git repository in the Vercel dashboard. The framework preset is detected automatically; no build settings need changing.

`vercel.json` registers an hourly cron for `/api/cron/unresolved`. **Vercel's Hobby plan only allows daily cron jobs.** On Hobby, change the schedule to e.g. `0 8 * * *`, or rely on the dashboard's "Check unresolved" button.

## 5. Verify

1. `curl https://your-domain/api/health` returns `{"status":"ok","database":"ok"}`. A `503` with `config: invalid` means an environment variable failed validation; the function log names it.
2. Sign in, create a request, and process it. Check the AI provider and model shown under **Settings → Integrations → AI provider**.
3. Check response headers include `content-security-policy`, `strict-transport-security` and `x-frame-options: DENY`.
4. Confirm RLS is active for the runtime role:

   ```sql
   -- as relayops_app, without setting app.* context
   select count(*) from customer_requests;   -- expect 0
   ```

5. Trigger the cron once: `curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/unresolved`.

## Other hosts

`npm run build && npm start` on any Node 22.12+ host. Put it behind HTTPS and set `APP_URL` accordingly. Schedule `/api/cron/unresolved` with any scheduler that can send the bearer header.

## Upgrades

Add a new numbered file in `db/migrations/` and run `npm run db:migrate` (as the owner) before deploying code that depends on it. Applied migrations are tracked in `public.schema_migrations`.

## Resetting a demo deployment

```bash
NODE_ENV=production ALLOW_DESTRUCTIVE_RESET=true npm run db:reset   # with DATABASE_ADMIN_URL set
```

`db:reset` refuses to run in production without that override.
