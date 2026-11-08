import "server-only";
import { randomBytes } from "node:crypto";
import type { Tx } from "@/server/db/pool";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";

export type OutgoingMessage = {
  businessId: string;
  proposalId: string;
  requestId: string;
  customerId: string | null;
  to: string;
  subject: string;
  body: string;
};

export type DeliveryReceipt = {
  provider: string;
  simulated: boolean;
  status: "simulated_delivered" | "sent";
  providerMessageId: string;
  deliveryId: string;
};

/**
 * Delivery adapters send an approved customer message. The proposal id is the
 * idempotency key: message_deliveries.proposal_id is unique, so one proposal
 * can produce at most one delivery record.
 *
 * A real provider (SES, Postmark, Resend...) should implement this interface
 * with an outbox: write the delivery row in the execution transaction, send
 * after commit with the proposal id as the provider idempotency key, then
 * record the provider's message id.
 */
export interface DeliveryProvider {
  readonly name: string;
  readonly simulated: boolean;
  send(tx: Tx, message: OutgoingMessage): Promise<DeliveryReceipt>;
}

/**
 * Records the message as a simulated delivery. Nothing leaves the system.
 * Recipients on the reserved `.invalid` top-level domain fail, so the
 * failure path can be exercised in demos and tests.
 */
export class MockDeliveryProvider implements DeliveryProvider {
  readonly name = "mock";
  readonly simulated = true;

  async send(tx: Tx, message: OutgoingMessage): Promise<DeliveryReceipt> {
    if (/\.invalid$/i.test(message.to)) {
      throw new AppError("unavailable", "Simulated delivery failed: the recipient's mail server rejected the message (undeliverable address).");
    }
    const providerMessageId = `sim_${randomBytes(9).toString("base64url")}`;
    const row = await tx.one<{ id: string }>(
      `insert into message_deliveries
         (business_id, proposal_id, request_id, customer_id, to_address, subject, body, provider, simulated, status, provider_message_id)
       values ($1, $2, $3, $4, $5, $6, $7, 'mock', true, 'simulated_delivered', $8)
       returning id`,
      [message.businessId, message.proposalId, message.requestId, message.customerId, message.to, message.subject, message.body, providerMessageId],
    );
    return { provider: this.name, simulated: true, status: "simulated_delivered", providerMessageId, deliveryId: row.id };
  }
}

export function deliveryProvider(): DeliveryProvider {
  switch (env().DELIVERY_PROVIDER) {
    case "mock":
      return new MockDeliveryProvider();
  }
}
