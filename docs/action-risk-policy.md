# Action risk and approval policy

RelayOps can perform exactly seven actions. The set is fixed in code (`src/lib/domain.ts`, `src/server/actions/registry.ts`). The AI can suggest them; it cannot add to them, change their risk, or run them.

## Principles

1. **Risk is a property of the action type, defined in code.** Model output never sets or lowers risk. `riskFor(type)` reads a constant table.
2. **Rules and settings can only tighten.** A workflow rule or the business setting "medium-risk actions require approval" can add an approval requirement. Nothing can remove one; a database trigger refuses `requires_approval: true → false`.
3. **Approval covers exact values.** An approval is stored with the proposal version and the SHA-256 hash of its canonical parameters. Editing anything creates a new version and voids the approval.
4. **A person executes.** The execution service accepts only signed-in users with the right permission. The AI pipeline, workflow rules, public form and intake API have no path to it.
5. **Validate at the point of execution.** Parameters are re-parsed and re-checked against current records immediately before the handler runs, inside the locked transaction.

## Risk tiers

### Low: automatic, no external effect

These happen during AI processing and change nothing outside RelayOps' analysis records. They are recorded in `ai_runs`, `request_classifications`, `retrieved_records` and the audit log.

- Classify a request
- Summarize a message
- Search authorized business records
- **Draft** a customer response. The draft is saved as a proposal; it is not sent.

### Medium: a permitted team member can execute directly

| Action | Effect |
| --- | --- |
| `update_request_status` | Changes the request's status. Only `needs_review`, `completed` or `rejected`, and only transitions the policy table allows; a reason is required. |
| `assign_team_member` | Assigns the request. The assignee must be an active member of the same business. |
| `add_internal_note` | Adds a staff-only note. |

Owners and members may execute these without approval, unless an owner has turned on **Settings → Medium-risk actions require approval** or a `proposal.created` rule requires approval (the seed includes one for status changes on return requests).

### High: explicit owner approval required before execution

| Action | Effect | Extra checks at proposal and execution time |
| --- | --- | --- |
| `draft_customer_response` (shown as "Send customer response") | Sends the exact message through the delivery adapter. **In this MVP the adapter is simulated, so nothing is emailed.** | The recipient must be the email of the customer who made the request (the request email or the matched customer record). Any other address is refused, which blocks exfiltration via injected instructions. |
| `create_service_request` | Creates a workshop ticket for the customer. | The customer must be the request's matched customer. |
| `propose_appointment` | Books an available appointment slot for the customer. | The slot must exist, have status `available`, be in the future and fit the service type, and must still be free at execution time. |
| `prepare_refund_request` | Creates a refund request for a manager to handle **outside** RelayOps. | The order must belong to the requesting customer; the amount must be positive and no more than the order total; the order must be within the return policy window (computed in code from the delivery date); only one pending request per order. **No money moves.** |

Members can create, edit and submit high-risk proposals and can execute them once approved. Only **owners** can approve or reject.

### Critical or unsupported: never executed

These have no action type, no handler and no code path. When the AI suggests one (for example because a customer message asked for it), the suggestion is discarded, recorded as `proposal.blocked_by_policy`, counted on the dashboard, and flagged on the request for review.

- Transfer money or issue an actual refund
- Delete data in bulk
- Change access permissions or roles
- Send to arbitrary recipients, call arbitrary URLs, run SQL, shell commands or code
- Create new tools or actions

## Proposal lifecycle

```
            ┌──────────── edit (new version, approvals voided) ───────────┐
            ▼                                                              │
         draft ── submit ──► pending_approval ── approve ──► approved ─────┤
           │                      │    ▲                        │          │
           │ (medium, no          │    └──── edit ──────────────┘          │
           │  approval needed)    └── reject ──► rejected                  │
           ▼                                                               │
       executing ◄──────────────── execute (approved) ─────────────────────┘
        │     │
        ▼     ▼
  executed   failed ── retry ──► executing
                  └── edit ──► draft
  (dismiss from any open state ──► cancelled)
```

The state machine is enforced by the `action_proposals_guard` trigger. Additional database-level checks:

- `pending_approval` is only possible when `requires_approval` is true.
- `approved` requires a non-invalidated `action_approvals` row with `decision = 'approved'`, the current `version` and the current `params_hash`.
- `executing` for an approval-required proposal requires the same.
- `executing → executed` happens at most once: the row is locked `FOR UPDATE`, and a unique index permits one succeeded execution per proposal.

## The approval step

The approval dialog shows:

- the action and the customer it affects;
- the exact values (for messages: recipient, subject and full body as it will be delivered);
- what will happen if it is approved, including "Delivery is simulated. No email leaves RelayOps." where relevant;
- the reason given, cited evidence, and any open questions the AI flagged;
- the version number and the parameter hash the approval will be bound to.

The decision request carries the version and hash the owner saw. If the proposal changed in the meantime, the decision is refused ("refuses a decision made against stale values" in the tests). The owner can choose to execute immediately after approving, which runs through the same execution service.

## Failures

If a handler fails (e.g. the slot was taken after approval), its transaction rolls back, so no partial effects remain. The proposal is marked `failed` with the reason in a separate transaction, and `action.execution_failed` is audited. A failed proposal is never shown as completed. It can be retried, which re-runs all checks, or edited back to draft, which requires new approval.

## Where this is tested

| Guarantee | Test |
| --- | --- |
| Fixed action set, strict params, unknown and dangerous types rejected | `tests/unit/action-registry.test.ts` |
| High-risk requires approval; refuses execution without it | `tests/integration/approvals.test.ts`: "approval gate" |
| Only owners approve | same: "only owners can approve; members cannot, even with the right hash" |
| Approval bound to exact values | same: "approval binding" |
| Database refuses bypass via direct status update | same: "cannot be bypassed by updating the status directly in the database" |
| Exactly-once under concurrency | same: "executes exactly once under concurrent attempts" |
| Rules can tighten but not relax | same: "rules can add an approval requirement but never remove one" |
| AI has no execution path; hostile provider contained | `tests/integration/ai-pipeline.test.ts` |
