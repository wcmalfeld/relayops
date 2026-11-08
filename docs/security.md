# Security model

This document describes the controls RelayOps implements and the risks that remain. It follows the direction of OWASP's guidance on [excessive agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) and the [AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html): minimal functionality, minimal permissions, independent authorization, and human approval for impactful actions.

**These controls reduce risk. They do not make the system production-secure.** No external penetration test or security review has been carried out.

## Threat model (summary)

| Actor | Can | Must not be able to |
| --- | --- | --- |
| Anonymous visitor | Submit the public intake form (rate limited) | Read anything, or create requests for another business |
| Integration with an API key | Create requests for the key's business | Choose the business, read data, or trigger execution |
| Customer (via message content) | Put arbitrary text into a request | Change AI behaviour in a way that bypasses policy, approval or tenancy; exfiltrate data |
| AI model (possibly manipulated or faulty) | Return structured suggestions | Execute, choose risk or permissions, reference other tenants' records, invent new actions |
| Team member | Work on requests they can see; execute medium-risk and approved actions | Approve; see other members' assigned requests; touch another tenant; rewrite the audit log |
| Owner | Everything in their business | Touch another tenant; rewrite the audit log; execute without approval |

## Controls

### Excessive agency (AI)

- **Fixed tool set.** Seven action types with strict Zod schemas (`z.strictObject`): unknown keys, unknown types and malformed UUIDs are rejected. There is no generic "call API", "run SQL", "send to URL" or code-execution action.
- **No execution path from AI.** `processRequest()` can only create proposals in `draft`. `executeProposal()` rejects any actor that is not a signed-in user. This is tested with a provider that returns maximally hostile output ("contains a fully hostile provider", "gives the AI pipeline no path to execution").
- **Risk and permissions in code.** `riskFor()` reads a constant table; `requires_approval` is computed server-side; the model's output has no field that influences either.
- **Context validation.** IDs in AI suggestions must exist in this business and relate to the requesting customer; evidence references must be records retrieval actually returned for this request; responses can only go to the requester's address.
- **Grounding check.** Drafts that contain amounts, order or tracking numbers, dates or stock claims not present in retrieved evidence, or record-based claims without citations, are flagged for review.
- **Quotas and limits.** Input truncation (`AI_MAX_INPUT_CHARS`), per-call timeout, bounded retries for transient errors only, and a per-business hourly AI run quota.

### Prompt injection

- Customer text, record contents and notes are wrapped in tags, with angle brackets neutralised, and the system prompt declares them untrusted data.
- `detectInjectionSignals()` flags common override patterns ("ignore previous instructions", role-play as admin, requests for secrets or customer lists). Flagged requests show a prominent warning and are routed to human review.
- **No control depends on the model obeying its instructions.** Even a fully compromised model can only produce draft proposals that pass the schema, context and grounding checks and then wait for a person.
- Seeded example: REQ-1012 asks the AI to approve a $5,000 refund, grant admin access and email the customer list. The result: the request is flagged, the unsupported actions are blocked by policy and audited, and nothing executes.

### Authentication and sessions

- scrypt password hashes; credentials are readable only through a `SECURITY DEFINER` function, never by the runtime role.
- 256-bit random session tokens, stored only as HMAC-SHA256 hashes. `HttpOnly`, `SameSite=Lax`, and `Secure` + `__Host-` prefix over HTTPS. Sessions are revocable and expire.
- Login rate limiting per email and per IP, with generic failure messages.
- Production refuses to start with the development `AUTH_SECRET`.

### Authorization and tenant isolation

- Every server action, route handler and service function resolves the session server-side and checks `assertCan()`. Hiding controls in the UI is only a convenience.
- The business context comes from the session row. Client-supplied business IDs are never used for access decisions; the API rejects them as unknown fields.
- The database enforces isolation independently: the runtime role is `NOSUPERUSER NOBYPASSRLS`, owns nothing, and has RLS on every table plus column-level update grants. A forged `app.business_id` without membership resolves to no business.
- Composite foreign keys `(business_id, id)` prevent cross-tenant references even by buggy code.
- Requests by ID from another tenant, or by a member for a request assigned to someone else, return not found (no existence leak).

### Approval integrity and exactly-once execution

See [action-risk-policy.md](action-risk-policy.md). The key properties are enforced by database triggers and constraints, not just application code: version and hash binding, approval invalidation on edit, the status state machine, owner-only approval inserts, and a unique successful execution per proposal. Execution re-validates everything inside a row-locked transaction.

### Audit log

- Append-only: a trigger raises on `UPDATE`/`DELETE` for every role, and the runtime role has only `INSERT`/`SELECT`.
- Metadata passes through `sanitizeMetadata()`, which keeps identifiers, codes, counts and short labels, and drops keys and values that look like message content, email addresses, phone numbers, tokens, keys or passwords. Strings are truncated and depth is bounded. Tested in `audit-sanitize.test.ts` and `audit.test.ts`.
- AI runs record provider, model, prompt version, latency, token counts and error codes, not prompts. Full prompt logging (`AI_LOG_PROMPTS`) is off by default.

### Web and transport

- Per-request CSP with a script nonce and `strict-dynamic`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`; `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, a restrictive `Permissions-Policy`, HSTS, and COOP.
- React output encoding throughout; no `dangerouslySetInnerHTML`.
- Server actions are POST-only and checked for same-origin by Next.js; the intake API uses bearer keys, not cookies.
- Safe errors: `AppError` codes map to user-facing messages; unexpected errors are logged server-side with a summary (no message bodies), and the client gets a generic message.
- Input limits on every schema (lengths, counts), a 32 KB API body cap, a honeypot on the public form, and Postgres-backed rate limits that hold across serverless instances.

### Secrets

- All secrets come from environment variables validated at startup. `.env.local` is git-ignored; `.env.example` contains placeholders only.
- API keys for intake are shown once and stored hashed.
- `describeAIConfig()` exposes only whether a key is configured, never the key.

## Remaining risks

These are known gaps, roughly in order of importance for a real deployment.

1. **Owner compromise is total within a tenant.** There is no two-person approval, step-up authentication or MFA. A stolen owner session can approve and execute any high-risk proposal. Add MFA (or move to Supabase Auth or SSO) and consider dual control for refunds.
2. **App-managed authentication** lacks password reset, email verification, MFA, account lockout notifications and device management. It has had no external review.
3. **Draft content can still be wrong or manipulated.** The grounding check is pattern-based. A paraphrased false claim ("it's on its way") can pass, and an injected message can still steer the tone or content of a draft. A human must read every message before approving. Approvers may come to rubber-stamp; the UI shows claims by basis to counter this, but that is not a guarantee.
4. **Third-party data processing.** With a hosted AI provider, customer messages and retrieved record facts are sent to that provider. A real deployment needs a data processing agreement, a retention policy, and possibly redaction.
5. **Audit immutability is enforced against the application, not the database owner.** Anyone with the `relayops_owner` credentials or superuser access can disable triggers. For tamper evidence, ship audit events to external append-only storage.
6. **`SECURITY DEFINER` functions are a privileged surface.** They are narrow, but every change to them needs careful review (search_path is pinned).
7. **No CAPTCHA on the public form.** The honeypot and per-IP limits deter casual spam, not a determined attacker with many IPs.
8. **Rate limiting is basic.** Fixed-window counters in Postgres; no DDoS protection. Put the app behind the platform's edge protection.
9. **PII at rest is stored in plaintext columns.** This relies on the database provider's disk encryption. There is no field-level encryption, retention or deletion tooling (e.g. for erasure requests).
10. **CSP allows inline styles** (`style-src 'unsafe-inline'`), which chart and dialog libraries need.
11. **Hosted AI adapters were not exercised against live APIs.** Their parsing is tested with simulated responses only.
12. **Demo credentials are public.** Never run `db:seed` against a production database, or change all passwords and remove demo users if you do. `db:reset` refuses to run with `NODE_ENV=production` unless explicitly overridden.
13. **Dependency hygiene.** At the time of writing, `npm audit --omit=dev` reports 0 vulnerabilities. A high-severity advisory exists in a development-only transitive dependency (`braces`, via the ESLint toolchain), which is not shipped. Run audits in CI.
