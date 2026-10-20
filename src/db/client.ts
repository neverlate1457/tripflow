import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type TripDatabase = ReturnType<typeof createDatabase>;

function createDatabase(databasePath: string) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

let database: TripDatabase | undefined;

/** Importing repositories or API handlers must not open a database. */
export function getDb(): TripDatabase {
  // Tests never use DATABASE_URL, even when inherited from a developer's shell.
  const databasePath = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test'
    ? ':memory:'
    : process.env.DATABASE_URL ?? './data/tripflow.db';
  return database ??= createDatabase(databasePath);
}
