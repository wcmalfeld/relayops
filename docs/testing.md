# Testing

## Running

```bash
npm run lint
npm run typecheck
npm test                 # unit + integration (Vitest)
npm run test:e2e         # Playwright, full UI workflow
npm run build
npm run check            # lint + typecheck + test + build
```

**Integration tests** use the real PostgreSQL test database (`TEST_DATABASE_URL`, `TEST_DATABASE_ADMIN_URL`). Global setup drops and recreates it from the migrations and the demo seed on every run. The app connects as the restricted `relayops_app` role, so RLS is active during the tests exactly as in production. The helpers refuse to run if the test database is the same as `DATABASE_URL`. Files run sequentially because they share one database.

**End-to-end tests** (`e2e/`) start `next dev` on port 3100 pointed at the test database, with `AI_PROVIDER=mock`, after resetting it with `scripts/db.ts reset`. Install a browser with `npx playwright install chromium`, or point at an existing one with `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome`.

No test calls a real AI provider or the network. The hosted adapters are tested against simulated HTTP responses.

## Results at delivery

Run in the build environment (Node 22.22, PostgreSQL 16) on 2026-10-16:

| Check | Result |
| --- | --- |
| `npm run lint` | passed, 0 problems |
| `npm run typecheck` | passed (strict) |
| `npm test` | **74 passed** in 12 files |
| `npm run test:e2e` | **3 passed** |
| `npm run build` | passed; 16 routes |

## Coverage of the required scenarios

| # | Scenario | Where |
| --- | --- | --- |
| 1 | Create a request | `integration/intake.test.ts`: "creates a request linked to the matching customer and audits it"; also idempotent retries; e2e workflow |
| 2 | Validate malformed input | `integration/intake.test.ts`: "rejects malformed input with field errors"; `integration/api-intake.test.ts` |
| 3 | Classify using the mock provider | `integration/ai-pipeline.test.ts`: "classifies, retrieves records and drafts a grounded response for review"; `unit/ai-providers.test.ts` |
| 4 | Unavailable AI service | `integration/ai-pipeline.test.ts`: "keeps the product usable when the provider is unavailable"; `unit/ai-providers.test.ts` (retries, timeouts) |
| 5 | Missing business information | `integration/ai-pipeline.test.ts`: "asks for information instead of guessing when records are missing"; `unit/ai-providers.test.ts` |
| 6 | Cross-business access | `integration/tenancy.test.ts`: "never returns another business", "does not let one tenant…", "rejects writes that reference another tenant" |
| 7 | Unauthorized approval | `integration/approvals.test.ts`: "only owners can approve; members cannot, even with the right hash"; e2e (member has no approve control) |
| 8 | AI cannot execute directly | `integration/ai-pipeline.test.ts`: "gives the AI pipeline no path to execution" |
| 9 | Manipulated identifiers | `integration/tenancy.test.ts`: "ignores a forged business id when the user is not a member", "limits members to assigned and unassigned requests"; `integration/api-intake.test.ts` (key decides business) |
| 10 | Supported action types and params | `unit/action-registry.test.ts`: "accepts every supported action with valid parameters", "rejects unexpected fields, invalid identifiers and unsupported values" |
| 11 | Unknown actions | `unit/action-registry.test.ts`: "rejects unknown action types, including dangerous ones" |
| 12 | High-risk actions require approval | `integration/approvals.test.ts`: "requires approval for high-risk actions and refuses to execute without it"; `unit/action-registry.test.ts` (risk in code) |
| 13 | Approval invalidated on change | `integration/approvals.test.ts`: "invalidates an approval when parameters change", "refuses to execute when the caller saw an older version", "refuses a decision made against stale values" |
| 14 | No duplicate execution | `integration/approvals.test.ts`: "executes exactly once under concurrent attempts" |
| 15 | Successful and failed executions recorded | `integration/approvals.test.ts`: "records simulated delivery as simulated", "records failures clearly and does not mark them completed", "re-checks records at execution time" |
| 16 | Prompt injection | `integration/ai-pipeline.test.ts`: "contains a fully hostile provider"; `unit/guards.test.ts` (signals, fencing, truncation) |
| 17 | Approval bypass | `integration/approvals.test.ts`: "cannot be bypassed by updating the status directly in the database", "rules can add an approval requirement but never remove one" |
| 18 | Unauthorized external actions | `integration/ai-pipeline.test.ts` (hostile provider tries arbitrary recipients and unsupported actions); `integration/approvals.test.ts`: "does not allow the recipient to be changed to an arbitrary address"; `integration/intake.test.ts`: "does not let a scheduler context create requests" |
| 19 | Input and output validation | `unit/guards.test.ts`: grounding check; `integration/ai-pipeline.test.ts`: "rejects output that fails schema validation"; `unit/rules-schema.test.ts` |
| 20 | No sensitive data in audit metadata | `integration/audit.test.ts`: "stores no message content, contact details or secrets in metadata", "is append-only for every role", "keeps credentials and sessions unreadable to the runtime role"; `unit/audit-sanitize.test.ts` |
| 21–26 | End-to-end flow | `e2e/workflow.spec.ts`: a member submits a request → the AI classification is shown beside the original message and retrieved order record → a response proposal is sent for approval → the owner reviews the exact values and approves and executes → the simulated delivery is recorded and labelled → the request state, proposal history and activity timeline (submitted, approved, simulated delivery, executed) are verified, plus the audit log page |

## What is not tested

- Live calls to Anthropic or OpenAI-compatible APIs (no credentials in the build environment).
- Deployment on Vercel or Supabase (see [deployment.md](deployment.md)).
- Load, soak and concurrency beyond the targeted double-execution test.
- Automated accessibility audits (axe). Status badges use text and icons, not colour alone, and forms have labels, but no automated audit was run.
- Cross-browser e2e (Chromium only).
