import "server-only";

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";
import * as relations from "./relations";

// THE app control-plane DB. Unlike lib/db/connection-pool.ts (per-customer
// external connections, hashed + TTL-evicted), this is a single long-lived pool
// for the app's own Postgres — one per process, no eviction.
//
// A persistent pool is correct here because the app runs as a long-lived Fly
// machine (see instrumentation.ts), not per-invocation serverless. If this ever
// moves to a serverless runtime, a per-invocation Pool would exhaust Postgres
// connections — switch to a transaction-mode pooler (PgBouncer / Supabase
// pooler) or max:1 behind external pooling.
//
// The globalThis guard prevents pool multiplication across Next dev HMR reloads.
const globalForDb = globalThis as unknown as { __appPgPool?: Pool };

export const pool =
  globalForDb.__appPgPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

if (process.env.NODE_ENV !== "production") globalForDb.__appPgPool = pool;

export const db = drizzle(pool, { schema: { ...schema, ...relations } });
