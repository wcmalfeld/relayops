import "server-only";
import { pool, Tx } from "@/server/db/pool";
import type { ActorContext } from "@/server/auth/types";

/**
 * Run `fn` inside a transaction whose row-level-security context is derived
 * from a server-built actor context. Business and user identifiers come from
 * the authenticated session (or a server-resolved system source), never from
 * client input. RLS then confines every statement to that business, and the
 * database ignores the business id unless the user is an active member.
 */
export async function withTenant<T>(ctx: ActorContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    await client.query(
      `select set_config('app.actor', $1, true),
              set_config('app.user_id', $2, true),
              set_config('app.business_id', $3, true)`,
      [ctx.kind, ctx.kind === "user" ? ctx.userId : "", ctx.businessId],
    );
    const result = await fn(new Tx(client));
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * User-scoped transaction without a business, used only to list the businesses
 * a signed-in user belongs to.
 */
export async function withUserScope<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    await client.query(
      `select set_config('app.actor', 'user', true), set_config('app.user_id', $1, true), set_config('app.business_id', '', true)`,
      [userId],
    );
    const result = await fn(new Tx(client));
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
