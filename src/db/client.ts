import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const databasePath = process.env.DATABASE_URL ?? './data/tripflow.db';
if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
const sqlite = new Database(databasePath);
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
