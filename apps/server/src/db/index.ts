import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export interface Database {
  db: Db;
  close(): Promise<void>;
}

/**
 * Подключение к базе. `postgres://...` — настоящий PostgreSQL,
 * `pglite://memory` или `pglite://./путь` — встроенный PostgreSQL для разработки и тестов.
 * Миграции применяются при старте.
 */
export async function openDatabase(url: string): Promise<Database> {
  if (url.startsWith("pglite:")) {
    const target = url.slice("pglite://".length);
    if (target && target !== "memory") mkdirSync(target, { recursive: true });
    const client = new PGlite(target && target !== "memory" ? target : undefined);
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder });
    return { db: db as unknown as Db, close: () => client.close() };
  }
  const client = postgres(url, { max: 10 });
  const db = drizzlePostgres(client, { schema });
  await migratePostgres(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => client.end() };
}

export { schema };
