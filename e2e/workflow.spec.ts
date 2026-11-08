import { test, expect, type Page } from "@playwright/test";

/**
 * Tests 21-26: the full reviewer workflow through the real UI.
 *
 *   21 a team member submits a customer request
 *   22 the AI classification is shown next to the original message
 *   23 a proposed customer response is generated and sent for approval
 *   24 an owner approves the exact version
 *   25 it executes through the simulated delivery adapter
 *   26 the request state and the audit trail reflect what happened
 */

const PASSWORD = "relayops-demo-2026";
const MEMBER = "frontdesk@summitcycles.example"; // Priya Patel, member
const OWNER = "owner@summitcycles.example"; // Maya Chen, owner

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL(/\/login/);
}

test("request moves from intake to approved, simulated delivery with a full audit trail", async ({ page }) => {
  const subject = `Where is my order SC-10421? (e2e ${Date.now()})`;

  // 21. Member submits a request (Alex Morgan is a known customer with order SC-10421).
  await signIn(page, MEMBER);
  await page.goto("/requests/new");
  await page.getByLabel("Customer name").fill("Alex Morgan");
  await page.getByLabel("Email", { exact: true }).fill("alex.morgan@example.com");
  await page.getByLabel("Subject").fill(subject);
  await page
    .getByLabel("Message")
    .fill("Hi, I ordered a bike last week, order SC-10421. Can you tell me when it will arrive? Thanks, Alex");
  await expect(page.getByRole("checkbox", { name: /Classify and draft with AI/ })).toBeChecked();
  await page.getByRole("button", { name: "Create request" }).click();
  await page.waitForURL(/\/requests\/[0-9a-f-]{36}$/);
  const requestUrl = page.url();

  // 22. Original message and AI classification are both visible.
  await expect(page.getByRole("heading", { level: 1, name: subject })).toBeVisible();
  await expect(page.getByText("Original message")).toBeVisible();
  await expect(page.getByText("AI interpretation")).toBeVisible();
  await expect(page.getByText("Order status").first()).toBeVisible();
  // Retrieval used the persisted order record.
  await expect(page.getByText("Business records found")).toBeVisible();
  await expect(page.getByText("SC-10421").first()).toBeVisible();

  // 23. A customer response proposal exists, requires approval, and the member cannot decide it.
  const proposal = page.locator("article").filter({ has: page.getByRole("heading", { name: "Send customer response" }) }).first();
  await expect(proposal).toBeVisible();
  await expect(proposal.getByText("Owner approval required before this can run.")).toBeVisible();
  await expect(proposal.getByText("alex.morgan@example.com")).toBeVisible();
  await expect(proposal.getByRole("button", { name: /Review and decide/ })).toHaveCount(0);
  await expect(proposal.getByRole("button", { name: /^Execute$/ })).toHaveCount(0);
  await proposal.getByRole("button", { name: /Send for approval/ }).click();
  await expect(proposal.getByText("Waiting for an owner to approve.")).toBeVisible();
  await signOut(page);

  // 24-25. Owner reviews the exact values, approves and executes.
  await signIn(page, OWNER);
  await page.goto("/approvals");
  await expect(page.getByText(subject).first()).toBeVisible();
  await page.goto(requestUrl);
  const ownerCard = page.locator("article").filter({ has: page.getByRole("heading", { name: "Send customer response" }) }).first();
  await ownerCard.getByRole("button", { name: /Review and decide/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Approve this action?")).toBeVisible();
  await expect(dialog.getByText("alex.morgan@example.com")).toBeVisible();
  await expect(dialog.getByText("Delivery is simulated. No email leaves RelayOps.")).toBeVisible();
  await expect(dialog.getByText(/values sealed as/)).toBeVisible();
  await dialog.getByLabel("Comment (optional)").fill("Looks right.");
  await dialog.getByRole("button", { name: "Approve and execute" }).click();
  await expect(dialog).toBeHidden();

  // 26. State and audit history are updated.
  await page.reload();
  await expect(page.getByText("No open proposals.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
  await expect(page.getByText("Recorded by the simulated delivery adapter. No real email was sent.")).toBeVisible();
  await expect(page.getByText(/^To alex\.morgan@example\.com,/)).toBeVisible();
  // The delivered text states the tracking number from the order record.
  await expect(page.getByRole("paragraph").filter({ hasText: /tracking number is 1Z999AA10123456784/ })).toBeVisible();
  await page.getByText(/Completed and dismissed \(1\)/).click();
  const done = page.locator("article").filter({ has: page.getByRole("heading", { name: "Send customer response" }) }).first();
  await expect(done.getByText("Executed", { exact: true }).first()).toBeVisible();
  await expect(done.getByText("Simulated", { exact: true })).toBeVisible();
  await expect(done.getByText(/Approved by Maya Chen for version/)).toBeVisible();

  await expect(page.getByText("Every recorded step for this request, newest first. The log cannot be edited.")).toBeVisible();
  const event = (re: RegExp) => page.locator("ol > li").filter({ hasText: re }).first();
  await expect(event(/Request received via manual/)).toBeVisible();
  await expect(event(/AI processing finished: classified as order status/)).toBeVisible();
  await expect(event(/Priya Patel sent send customer response for approval/)).toBeVisible();
  await expect(event(/Maya Chen approved send customer response/)).toBeVisible();
  await expect(event(/Message recorded by the simulated delivery adapter \(not sent\)/)).toBeVisible();
  await expect(event(/Executed send customer response/)).toBeVisible();

  // The business-wide audit log shows the same events.
  await page.goto("/audit");
  await expect(page.getByText(/simulated delivery adapter/).first()).toBeVisible();
});

test("signed-out visitors are redirected and cannot reach business pages", async ({ page }) => {
  await page.goto("/requests");
  await expect(page).toHaveURL(/\/login/);
});

test("members see settings read-only and get no approval controls in the queue", async ({ page }) => {
  await signIn(page, MEMBER);
  await page.goto("/settings");
  await expect(page.getByText("Read-only for team members. Ask an owner to change settings.")).toBeVisible();
  await page.goto("/approvals");
  await expect(page.getByRole("button", { name: /Review and decide/ })).toHaveCount(0);
});
