import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const databasePath = process.env.DATABASE_URL ?? './data/tripflow.db';
if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
