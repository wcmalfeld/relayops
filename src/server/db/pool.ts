import "server-only";
import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { env } from "@/server/env";

// Return BIGINT/NUMERIC as numbers. Values in this app stay well within
// Number.MAX_SAFE_INTEGER (counts, minutes, cents).
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

const globalForPool = globalThis as unknown as { __relayopsPool?: Pool };

export function pool(): Pool {
  if (!globalForPool.__relayopsPool) {
    const p = new Pool({
      connectionString: env().DATABASE_URL,
      max: env().DATABASE_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
      application_name: "relayops-web",
    });
    p.on("error", (err) => console.error("[relayops] idle database client error", err.message));
    globalForPool.__relayopsPool = p;
  }
  return globalForPool.__relayopsPool;
}

export async function closePool() {
  if (globalForPool.__relayopsPool) {
    await globalForPool.__relayopsPool.end();
    globalForPool.__relayopsPool = undefined;
  }
}

/** A thin, typed wrapper around a transaction-bound client. */
export class Tx {
  constructor(readonly client: PoolClient) {}

  async many<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.client.query<T>(sql, params);
    return res.rows;
  }

  async maybeOne<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
    const res = await this.client.query<T>(sql, params);
    return res.rows[0] ?? null;
  }

  async one<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T> {
    const row = await this.maybeOne<T>(sql, params);
    if (!row) throw new Error("Expected exactly one row");
    return row;
  }

  async exec(sql: string, params: unknown[] = []): Promise<number> {
    const res = await this.client.query(sql, params);
    return res.rowCount ?? 0;
  }

  /**
   * Run `fn` inside a savepoint so a failed statement only rolls back this
   * step instead of aborting the whole transaction.
   */
  async savepoint<T>(fn: () => Promise<T>): Promise<T> {
    const name = `sp_${++this.savepoints}`;
    await this.client.query(`savepoint ${name}`);
    try {
      const result = await fn();
      await this.client.query(`release savepoint ${name}`);
      return result;
    } catch (err) {
      await this.client.query(`rollback to savepoint ${name}`);
      throw err;
    }
  }

  private savepoints = 0;
}

/** Run statements that need no tenant context (auth entry points only). */
export async function withConnection<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    return await fn(new Tx(client));
  } finally {
    client.release();
  }
}
