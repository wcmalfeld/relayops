/**
 * Database tooling.
 *
 *   npm run db:setup    create roles and databases (local Postgres superuser)
 *   npm run db:migrate  apply db/migrations/*.sql in order
 *   npm run db:seed     load the Summit Cycles demo data and run the demo workflow
 *   npm run db:reset    drop all objects, migrate, and seed again
 *
 * Migrations and seeds run as the schema owner (DATABASE_ADMIN_URL). The web
 * application connects as the restricted runtime role (DATABASE_URL).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
    process.exit(1);
  }
  return value;
}

function parse(url: string) {
  const u = new URL(url);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
  };
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Unsafe identifier: ${s}`);
  return `"${s}"`;
};
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function setup() {
  const superUrl = process.env.PG_SUPERUSER_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
  const admin = parse(requireEnv("DATABASE_ADMIN_URL"));
  const app = parse(requireEnv("DATABASE_URL"));
  const databases = [admin.database];
  if (process.env.TEST_DATABASE_ADMIN_URL) databases.push(parse(process.env.TEST_DATABASE_ADMIN_URL).database);

  const c = new Client({ connectionString: superUrl });
  await c.connect();
  try {
    for (const [role, pw, extra] of [
      [admin.user, admin.password, "NOSUPERUSER NOCREATEROLE"],
      [app.user, app.password, "NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT"],
    ] as const) {
      const exists = await c.query("select 1 from pg_roles where rolname = $1", [role]);
      const verb = exists.rowCount ? "alter" : "create";
      await c.query(`${verb} role ${ident(role)} with login password ${literal(pw)} ${extra}`);
      console.log(`${verb === "create" ? "created" : "updated"} role ${role}`);
    }
    for (const db of databases) {
      const exists = await c.query("select 1 from pg_database where datname = $1", [db]);
      if (!exists.rowCount) {
        await c.query(`create database ${ident(db)} owner ${ident(admin.user)}`);
        console.log(`created database ${db}`);
      }
      await c.query(`grant connect on database ${ident(db)} to ${ident(app.user)}`);
    }
  } finally {
    await c.end();
  }
  // pg_trgm must be created by a superuser on stock Postgres.
  for (const db of databases) {
    const u = new URL(superUrl);
    u.pathname = `/${db}`;
    const dc = new Client({ connectionString: u.toString() });
    await dc.connect();
    await dc.query("create extension if not exists pg_trgm");
    await dc.end();
  }
}

export async function migrate(adminUrl = requireEnv("DATABASE_ADMIN_URL"), quiet = false) {
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query(`create table if not exists public.schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    const applied = new Set((await c.query<{ name: string }>("select name from public.schema_migrations")).rows.map((r) => r.name));
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      await c.query("begin");
      try {
        await c.query(sql);
        await c.query("insert into public.schema_migrations (name) values ($1)", [file]);
        await c.query("commit");
        if (!quiet) console.log(`applied ${file}`);
      } catch (err) {
        await c.query("rollback");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await c.end();
  }
}

export async function dropAll(adminUrl = requireEnv("DATABASE_ADMIN_URL")) {
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query("drop schema if exists app cascade");
    // Drop every table in public owned by us, keeping the schema (and the
    // superuser-created pg_trgm extension) in place.
    const tables = await c.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tableowner = current_user",
    );
    for (const { tablename } of tables.rows) {
      await c.query(`drop table if exists public.${ident(tablename)} cascade`);
    }
  } finally {
    await c.end();
  }
}

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case "setup":
      await setup();
      break;
    case "migrate":
      await migrate();
      break;
    case "seed": {
      const { seed } = await import("../db/seed/seed");
      await seed();
      break;
    }
    case "reset": {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_DESTRUCTIVE_RESET !== "true") {
        throw new Error("Refusing to reset a production database. Set ALLOW_DESTRUCTIVE_RESET=true to override.");
      }
      await dropAll();
      await migrate();
      const { seed } = await import("../db/seed/seed");
      await seed();
      break;
    }
    default:
      console.error("Usage: tsx scripts/db.ts <setup|migrate|seed|reset>");
      process.exit(1);
  }
}

if (process.argv[1]?.endsWith("db.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
